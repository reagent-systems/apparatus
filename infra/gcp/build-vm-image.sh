#!/usr/bin/env bash
# Build a new image in the apparatus-vm family from infra/vm/setup.sh. Used by deploy.yml.
# Packs the repository, so it runs from the root wherever it is called from.
# PACK_ONLY=1 writes the tarball and exits before any gcloud call.
# BUILDER_NETWORK (default: default) and BUILDER_SUBNET pick the builder's network; it needs an SSH rule.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${GCP_PROJECT:?}" "${GCP_ZONE:?}"
TARBALL="${TARBALL:-/tmp/apparatus.tgz}"

# Tracked files only. The tree also holds .env, terraform state and CI credentials, and the
# agent user in the VM can read everything under /opt/apparatus.
pack() {
  git ls-files -z | while IFS= read -r -d '' f; do
    if [ -e "$f" ] || [ -L "$f" ]; then printf '%s\0' "$f"; fi
  done | tar --null --no-recursion -T - -czf "$1"
}
pack "$TARBALL"
if [ "${PACK_ONLY:-}" = 1 ]; then echo "packed $TARBALL"; exit 0; fi

STAMP="$(date +%Y%m%d%H%M)"
BUILDER="apparatus-vm-builder-$STAMP"
gcloud compute instances create "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE" \
  --image-family debian-12 --image-project debian-cloud --machine-type e2-standard-2 \
  --boot-disk-size 50GB --scopes cloud-platform \
  --network "${BUILDER_NETWORK:-default}" ${BUILDER_SUBNET:+--subnet "$BUILDER_SUBNET"}
cleanup() { gcloud compute instances delete "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE" --quiet || true; }
trap cleanup EXIT
sleep 40
gcloud compute scp "$TARBALL" "$BUILDER:/tmp/apparatus.tgz" --project "$GCP_PROJECT" --zone "$GCP_ZONE"
gcloud compute ssh "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE" --command \
  'sudo mkdir -p /opt/apparatus && sudo tar xzf /tmp/apparatus.tgz -C /opt/apparatus && sudo bash /opt/apparatus/infra/vm/setup.sh'
gcloud compute instances stop "$BUILDER" --project "$GCP_PROJECT" --zone "$GCP_ZONE"
gcloud compute images create "apparatus-vm-$STAMP" --project "$GCP_PROJECT" \
  --source-disk "$BUILDER" --source-disk-zone "$GCP_ZONE" --family apparatus-vm
echo "image apparatus-vm-$STAMP in family apparatus-vm"
