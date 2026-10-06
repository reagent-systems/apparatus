#!/usr/bin/env bash
# Build the session server image and push it to ECR. Prints the image URI on stdout.
# Progress goes to stderr. Run from anywhere inside the repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
: "${AWS_REGION:?}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REPO="${ECR_REPO:-$ACCOUNT.dkr.ecr.${AWS_REGION}.amazonaws.com/apparatus-server}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
IMAGE="$REPO:$TAG"
echo "push $IMAGE" >&2
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${REPO%%/*}" >&2
docker build --platform linux/amd64 -f server/Dockerfile -t "$IMAGE" . >&2
docker push "$IMAGE" >&2
printf '%s\n' "$IMAGE"
