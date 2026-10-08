# apparatus on GCP. One file per concern would be nicer; one file is easier to read first.
# Design spec, "GCP deployment": managed services for everything except the user VMs.
terraform {
  required_version = ">= 1.6"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
  }
}

provider "google" {
  project = var.project
  region  = var.region
}

locals {
  apis = [
    "compute.googleapis.com",
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "firestore.googleapis.com",
    "identitytoolkit.googleapis.com",
    "fcm.googleapis.com",
    "iam.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------------------
# Network: VMs have no inbound ports and reach only the internet through NAT
# and the session server. The metadata server is blocked on the VM itself.
# ---------------------------------------------------------------------------

resource "google_compute_network" "vpc" {
  name                    = "apparatus"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "vms" {
  name                     = "apparatus-vms"
  ip_cidr_range            = "10.40.0.0/20"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
}

resource "google_compute_router" "router" {
  name    = "apparatus-router"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_router_nat" "nat" {
  name                               = "apparatus-nat"
  router                             = google_compute_router.router.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_compute_firewall" "deny_all_ingress" {
  name      = "apparatus-deny-ingress"
  network   = google_compute_network.vpc.name
  direction = "INGRESS"
  priority  = 1000
  deny { protocol = "all" }
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["apparatus-vm"]
}

# Egress: HTTPS/WSS out (session server, web), DNS, NTP. Nothing internal.
resource "google_compute_firewall" "allow_egress_web" {
  name      = "apparatus-allow-egress-web"
  network   = google_compute_network.vpc.name
  direction = "EGRESS"
  priority  = 900
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  allow {
    protocol = "udp"
    ports    = ["53", "123", "3478"] # DNS, NTP, TURN
  }
  destination_ranges = ["0.0.0.0/0"]
  target_tags        = ["apparatus-vm"]
}

resource "google_compute_firewall" "deny_egress_internal" {
  name      = "apparatus-deny-egress-internal"
  network   = google_compute_network.vpc.name
  direction = "EGRESS"
  priority  = 800
  deny { protocol = "all" }
  destination_ranges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  target_tags        = ["apparatus-vm"]
}

# ---------------------------------------------------------------------------
# User VMs: a service account with no permissions, an image family, a snapshot
# schedule and an instance template. Instances themselves are created per user
# by the provisioning job (infra/gcp/provision-vm.sh) from this template.
# ---------------------------------------------------------------------------

resource "google_service_account" "vm" {
  account_id   = "apparatus-vm"
  display_name = "apparatus user VM (no permissions)"
}

resource "google_compute_resource_policy" "snapshots" {
  name   = "apparatus-daily-snapshots"
  region = var.region
  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "03:00"
      }
    }
    retention_policy {
      max_retention_days    = 14
      on_source_disk_delete = "KEEP_AUTO_SNAPSHOTS"
    }
  }
}

resource "google_compute_instance_template" "vm" {
  name_prefix  = "apparatus-vm-"
  machine_type = var.vm_machine_type
  tags         = ["apparatus-vm"]

  disk {
    source_image = "projects/${var.project}/global/images/family/${var.vm_image_family}"
    auto_delete  = false
    boot         = true
    disk_size_gb = var.vm_disk_gb
    disk_type    = "pd-balanced"
    resource_policies = [google_compute_resource_policy.snapshots.id]
  }

  network_interface {
    subnetwork = google_compute_subnetwork.vms.id
    # No external IP. Egress goes through Cloud NAT.
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = []
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = file("${path.module}/../vm/startup.sh")
    server_url     = "wss://${var.api_domain}/ws/agentd"
    enroll_secret  = var.vm_enroll_secret
  }

  shielded_instance_config {
    enable_secure_boot = true
    enable_vtpm        = true
  }

  lifecycle { create_before_destroy = true }
}

# ---------------------------------------------------------------------------
# Session server: Cloud Run, CPU always on, at least one instance. Its service
# account can start and stop user VMs, read two secrets and send FCM messages.
# ---------------------------------------------------------------------------

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "apparatus"
  format        = "DOCKER"
}

resource "google_service_account" "server" {
  account_id   = "apparatus-server"
  display_name = "apparatus session server"
}

resource "google_project_iam_custom_role" "vm_power" {
  role_id     = "apparatusVmPower"
  title       = "apparatus VM power"
  permissions = ["compute.instances.get", "compute.instances.start", "compute.instances.stop", "compute.instances.list"]
}

resource "google_project_iam_member" "server_vm_power" {
  project = var.project
  role    = google_project_iam_custom_role.vm_power.id
  member  = "serviceAccount:${google_service_account.server.email}"
}

resource "google_project_iam_member" "server_fcm" {
  project = var.project
  role    = "roles/firebasecloudmessaging.admin"
  member  = "serviceAccount:${google_service_account.server.email}"
}

resource "google_project_iam_member" "server_firestore" {
  project = var.project
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.server.email}"
}

resource "google_secret_manager_secret" "gemini_api_key" {
  secret_id = "gemini-api-key"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret" "vm_enroll_secret" {
  secret_id = "vm-enroll-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "vm_enroll_secret" {
  secret      = google_secret_manager_secret.vm_enroll_secret.id
  secret_data = var.vm_enroll_secret
}

# The coturn static-auth-secret. The server mints short-lived TURN credentials from it.
resource "google_secret_manager_secret" "turn_secret" {
  secret_id = "turn-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "turn_secret" {
  secret      = google_secret_manager_secret.turn_secret.id
  secret_data = var.turn_secret
}

resource "google_secret_manager_secret_iam_member" "server_reads_key" {
  secret_id = google_secret_manager_secret.gemini_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.server.email}"
}

resource "google_secret_manager_secret_iam_member" "server_reads_enroll" {
  secret_id = google_secret_manager_secret.vm_enroll_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.server.email}"
}

resource "google_secret_manager_secret_iam_member" "server_reads_turn" {
  secret_id = google_secret_manager_secret.turn_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.server.email}"
}

resource "google_cloud_run_v2_service" "server" {
  name     = "apparatus-server"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.server.email
    timeout                          = "3600s"
    max_instance_request_concurrency = 200
    session_affinity                 = true
    scaling {
      min_instance_count = 1
      max_instance_count = 20
    }
    containers {
      image = var.server_image
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "2", memory = "2Gi" }
        cpu_idle          = false # CPU always allocated: the agent loop runs between requests
        startup_cpu_boost = true
      }
      env {
        name  = "APPARATUS_AUTH_MODE"
        value = "firebase"
      }
      env {
        name  = "FIREBASE_PROJECT_ID"
        value = var.project
      }
      env {
        name  = "APPARATUS_VM_CONTROLLER"
        value = "gce"
      }
      env {
        name  = "GCE_PROJECT"
        value = var.project
      }
      env {
        name  = "GCE_ZONE"
        value = var.zone
      }
      env {
        name  = "APPARATUS_PUSH"
        value = "fcm"
      }
      env {
        name  = "APPARATUS_STORE"
        value = "file" # swap for the Firestore adapter when it lands (ROADMAP)
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.gemini_api_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "APPARATUS_VM_ENROLL_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.vm_enroll_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "APPARATUS_TURN_URL"
        value = "turn:${google_compute_address.turn.address}:3478?transport=udp"
      }
      env {
        name = "APPARATUS_TURN_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.turn_secret.secret_id
            version = "latest"
          }
        }
      }
    }
  }
  # deploy.yml owns the image after the first apply; a later apply keeps what it deployed.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  # The first revision reads the secrets at once: their versions and the read grants exist first.
  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_version.vm_enroll_secret,
    google_secret_manager_secret_version.turn_secret,
    google_secret_manager_secret_iam_member.server_reads_key,
    google_secret_manager_secret_iam_member.server_reads_enroll,
    google_secret_manager_secret_iam_member.server_reads_turn,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers" # the server authenticates every request itself
}

# ---------------------------------------------------------------------------
# State and login
# ---------------------------------------------------------------------------

resource "google_firestore_database" "db" {
  name        = "(default)"
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.apis]
}

# Identity Platform is enabled through the API list above; providers (email,
# Google, Apple) are configured in the console or with google_identity_platform_config.

# ---------------------------------------------------------------------------
# TURN relay for the screen stream: one small VM with coturn. WebRTC needs UDP,
# which Cloud Run cannot carry.
# ---------------------------------------------------------------------------

resource "google_compute_address" "turn" {
  name   = "apparatus-turn"
  region = var.region
}

resource "google_compute_firewall" "turn" {
  name    = "apparatus-turn"
  network = google_compute_network.vpc.name
  allow {
    protocol = "udp"
    ports    = ["3478", "49152-65535"]
  }
  allow {
    protocol = "tcp"
    ports    = ["3478"]
  }
  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["apparatus-turn"]
}

resource "google_compute_instance" "turn" {
  name         = "apparatus-turn"
  machine_type = "e2-small"
  zone         = var.zone
  tags         = ["apparatus-turn"]
  boot_disk {
    initialize_params { image = "debian-cloud/debian-12" }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.vms.id
    access_config { nat_ip = google_compute_address.turn.address }
  }
  metadata_startup_script = templatefile("${path.module}/turn-startup.sh.tftpl", {
    turn_secret = var.turn_secret
    realm       = var.api_domain
  })
  service_account {
    email  = google_service_account.vm.email
    scopes = []
  }
}
