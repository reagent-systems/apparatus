output "server_url" { value = google_cloud_run_v2_service.server.uri }
output "turn_ip" { value = google_compute_address.turn.address }
output "vm_instance_template" { value = google_compute_instance_template.vm.self_link }
output "vm_subnetwork" { value = google_compute_subnetwork.vms.self_link }
