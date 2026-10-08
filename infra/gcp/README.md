# GCP deployment

Everything is a managed service except the user VMs and one TURN relay. This folder
holds the Terraform for the project and the scripts the deploy workflow runs.

| Part | Resource | File |
|---|---|---|
| Network | VPC, subnet, Cloud NAT, firewall rules (no ingress to VMs, no internal egress) | `main.tf` |
| User VM | Instance template, snapshot schedule, service account with no roles | `main.tf`, `provision-vm.sh` |
| VM image | Debian 12 + Xfce + Chromium + agentd, built by `infra/vm/setup.sh` | `build-vm-image.sh` |
| Session server | Cloud Run v2, CPU always on, min 1 instance, session affinity | `main.tf` |
| Secrets | `gemini-api-key`, `vm-enroll-secret`, `turn-secret` in Secret Manager | `main.tf` |
| State | Firestore (native) | `main.tf` |
| Login | Identity Platform (enable providers in the console) | `main.tf` |
| Push | FCM through the server's service account | `main.tf` |
| Screen stream | coturn on an e2-small with a static IP | `main.tf`, `turn-startup.sh.tftpl` |
| Entry point | Cloud Run URL; map `api_domain` to it with a Cloud Run domain mapping or a load balancer | console |

## First deployment

The order matters. The instance template reads the `apparatus-vm` image family, so the VM
image exists before the full apply. Cloud Run reads `gemini-api-key:latest` and pulls the
server image, so the secret has a version and the image is in Artifact Registry before the
full apply. Every command runs from the repository root.

1. Sign in and pick the project:
   `gcloud auth login && gcloud auth application-default login && gcloud config set project PROJECT`.
2. Set the variables in the shell. Terraform reads `TF_VAR_*`, so no file holds a secret.
   Keep the two secrets somewhere safe: every later apply needs the same values.
   ```sh
   export GCP_PROJECT=PROJECT GCP_REGION=us-central1 GCP_ZONE=us-central1-a
   export TF_VAR_project=$GCP_PROJECT TF_VAR_region=$GCP_REGION TF_VAR_zone=$GCP_ZONE
   export TF_VAR_vm_enroll_secret="$(openssl rand -hex 32)" TF_VAR_turn_secret="$(openssl rand -hex 32)"
   export TF_VAR_server_image="$GCP_REGION-docker.pkg.dev/$GCP_PROJECT/apparatus/server:v0"
   export TF_VAR_api_domain=api.example.com   # your domain; without one, any name until step 9
   ```
3. Enable the APIs: `terraform -chdir=infra/gcp init && terraform -chdir=infra/gcp apply -target=google_project_service.apis`.
4. Build the VM image: `infra/gcp/build-vm-image.sh`. It packs the repository's tracked files
   wherever it is called from, runs `infra/vm/setup.sh` on a builder instance in the
   project's `default` network, and adds the image to the `apparatus-vm` family.
   Untracked files such as `.env` and the Terraform state never enter the image.
   If the project has no `default` network, create one with an SSH rule, or set
   `BUILDER_NETWORK` (and `BUILDER_SUBNET`) to a network that allows SSH:
   ```sh
   gcloud compute networks create default --subnet-mode=auto
   gcloud compute firewall-rules create default-allow-ssh --network default --allow tcp:22
   ```
5. Create the Artifact Registry repository and the Gemini key's secret:
   `terraform -chdir=infra/gcp apply -target=google_artifact_registry_repository.images -target=google_secret_manager_secret.gemini_api_key`.
6. Put the Gemini key in it: `printf '%s' "$GEMINI_API_KEY" | gcloud secrets versions add gemini-api-key --data-file=-`.
7. Build and push the server image:
   ```sh
   gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet
   docker build -f apps/server/Dockerfile -t "$TF_VAR_server_image" .
   docker push "$TF_VAR_server_image"
   ```
8. Apply everything: `terraform -chdir=infra/gcp apply`. IAM can take about a minute to
   propagate. If the apply fails with `Permission denied on secret`, run
   `terraform -chdir=infra/gcp apply` again.
9. Without a custom domain, point `api_domain` at the Cloud Run host and apply again. The VM
   template's `server_url` and the TURN realm come from it.
   ```sh
   export TF_VAR_api_domain="$(terraform -chdir=infra/gcp output -raw server_url | sed 's#^https://##')"
   terraform -chdir=infra/gcp apply
   ```
   With a custom domain, map it to the service instead (Cloud Run domain mapping or a load balancer).
10. Create a VM for a user: `GCP_PROJECT=... GCP_ZONE=... infra/gcp/provision-vm.sh <firebase-uid>`.

After the first deployment `.github/workflows/deploy.yml` pushes new server images and VM
images. Its `gcloud run deploy` merges its variables into the ones Terraform set. Terraform
ignores the service's image after the first apply, so a later `terraform apply` keeps the
image the workflow last deployed.

## Rules the design spec sets, and where they live

- The VM has no inbound ports: `deny_all_ingress` plus iptables in `infra/vm/setup.sh`.
- The VM reaches no internal service: `deny_egress_internal`. It reaches the session server over the public URL through NAT.
- The metadata server is blocked for the agent: iptables owner rule in `infra/vm/setup.sh`. The VM service account has no roles anyway.
- The API key never enters a VM: only the Cloud Run service account can read `gemini-api-key`.
- Snapshots: daily, 14 days, on the VM boot disk.
- Region: set `region` and `zone` near the users; the voice path adds delay per distance.

## Facts to verify before launch

- Cloud Run for hour-long agent loops. The service has `timeout = 3600s` and CPU always on. If a loop needs more, move the agent loop to GKE; the code does not change.
- VM start time from stopped. Measure it; the server waits `vm_connect_timeout` (180 s) for agentd.
- Firestore adapter for `APPARATUS_STORE`. The file store runs on Cloud Run's memory disk and is lost on restart; use it for staging only.
