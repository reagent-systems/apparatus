# GCP deployment

Everything is a managed service except the user VMs and one TURN relay. This folder
holds the Terraform for the project and the scripts the deploy workflow runs.

| Part | Resource | File |
|---|---|---|
| Network | VPC, subnet, Cloud NAT, firewall rules (no ingress to VMs, no internal egress) | `main.tf` |
| User VM | Instance template, snapshot schedule, service account with no roles | `main.tf`, `provision-vm.sh` |
| VM image | Debian 12 + Xfce + Chromium + agentd, built by `vm/setup.sh` | `build-vm-image.sh` |
| Session server | Cloud Run v2, CPU always on, min 1 instance, session affinity | `main.tf` |
| Secrets | `gemini-api-key`, `vm-enroll-secret` in Secret Manager | `main.tf` |
| State | Firestore (native) | `main.tf` |
| Login | Identity Platform (enable providers in the console) | `main.tf` |
| Push | FCM through the server's service account | `main.tf` |
| Screen stream | coturn on an e2-small with a static IP | `main.tf`, `turn-startup.sh.tftpl` |
| Entry point | Cloud Run URL; map `api_domain` to it with a Cloud Run domain mapping or a load balancer | console |

## First deployment

1. `gcloud auth application-default login` and pick the project.
2. Build and push the server image once: `gcloud builds submit -t REGION-docker.pkg.dev/PROJECT/apparatus/server:v0 .`
   (or let `.github/workflows/deploy.yml` do it).
3. `terraform init && terraform apply -var project=... -var api_domain=... -var server_image=... -var vm_enroll_secret=... -var turn_secret=...`
4. Put the Gemini key in Secret Manager: `printf '%s' "$KEY" | gcloud secrets versions add gemini-api-key --data-file=-`.
5. Build the VM image: `GCP_PROJECT=... GCP_ZONE=... ./build-vm-image.sh`.
6. Create a VM for a user: `GCP_PROJECT=... GCP_ZONE=... ./provision-vm.sh <firebase-uid>`.

## Rules the design spec sets, and where they live

- The VM has no inbound ports: `deny_all_ingress` plus iptables in `vm/setup.sh`.
- The VM reaches no internal service: `deny_egress_internal`. It reaches the session server over the public URL through NAT.
- The metadata server is blocked for the agent: iptables owner rule in `vm/setup.sh`. The VM service account has no roles anyway.
- The API key never enters a VM: only the Cloud Run service account can read `gemini-api-key`.
- Snapshots: daily, 14 days, on the VM boot disk.
- Region: set `region` and `zone` near the users; the voice path adds delay per distance.

## Facts to verify before launch

- Cloud Run for hour-long agent loops. The service has `timeout = 3600s` and CPU always on. If a loop needs more, move the agent loop to GKE; the code does not change.
- VM start time from stopped. Measure it; the server waits `vm_connect_timeout` (180 s) for agentd.
- The WebRTC desktop stream (Selkies or equivalent) on the VM image. It is not in this build.
- Firestore adapter for `APPARATUS_STORE`. The file store runs on Cloud Run's memory disk and is lost on restart; use it for staging only.
