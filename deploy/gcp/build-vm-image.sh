#!/usr/bin/env bash
# Build a new image in the apparatus-vm family from vm/setup.sh. Used by deploy.yml.
set -euo pipefail
: "${GCP_PROJECT:?}" "${GCP_ZONE:?}"
STAMP="$(date +%Y%m%d%H%M)"
BUILDER="apparatus-vm-builder-$STAMP"
gcloud compute instances create "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE" \
  --image-family debian-12 --image-project debian-cloud --machine-type e2-standard-2 \
  --boot-disk-size 50GB --scopes cloud-platform
cleanup() { gcloud compute instances delete "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE" --quiet || true; }
trap cleanup EXIT
sleep 40
tar czf /tmp/apparatus.tgz --exclude .git --exclude node_modules --exclude .venv --exclude web/dist .
gcloud compute scp /tmp/apparatus.tgz "$BUILDER:/tmp/" --project "$GCP_PROJECT" --zone "$GCP_ZONE"
gcloud compute ssh "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE" --command \
  'sudo mkdir -p /opt/apparatus && sudo tar xzf /tmp/apparatus.tgz -C /opt/apparatus && sudo bash /opt/apparatus/vm/setup.sh'
gcloud compute instances stop "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE"
gcloud compute images create "apparatus-vm-$STAMP" --project "$GCP_PROJECT" \
  --source-disk "$BUILDER" --source-disk-zone "$GCP_ZONE" --family apparatus-vm
echo "image apparatus-vm-$STAMP in family apparatus-vm"
