#!/usr/bin/env bash
# Build an AMI from vm/setup.sh. The builder has no role. It downloads a
# presigned tarball, runs setup, cleans cloud-init, and stops.
# Prints the AMI id on stdout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="$(cd "$(dirname "$0")" && pwd)"
: "${AWS_REGION:?}"

tf_out() {
  local var="$1" name="$2"
  if [ -n "${!var:-}" ]; then
    printf '%s' "${!var}"
    return
  fi
  terraform -chdir="$TF" output -raw "$name"
}

BUCKET="$(tf_out AWS_BUILD_BUCKET build_bucket)"
SUBNET="$(tf_out AWS_BUILDER_SUBNET builder_subnet_id)"
SG="$(tf_out AWS_BUILDER_SG builder_security_group_id)"
if [ -z "$BUCKET" ] || [ -z "$SUBNET" ] || [ -z "$SG" ]; then
  echo "set AWS_BUILD_BUCKET, AWS_BUILDER_SUBNET and AWS_BUILDER_SG, or apply deploy/aws first" >&2
  exit 1
fi
STAMP="$(date +%Y%m%d%H%M)"
KEY="build/apparatus-$STAMP.tgz"
BUILDER="apparatus-vm-builder-$STAMP"

tar czf /tmp/apparatus.tgz \
  --exclude .git --exclude node_modules --exclude .venv --exclude web/dist \
  --exclude 'deploy/aws/.terraform' \
  -C "$ROOT" .
aws s3 cp /tmp/apparatus.tgz "s3://$BUCKET/$KEY" --region "$AWS_REGION" >&2
URL="$(aws s3 presign "s3://$BUCKET/$KEY" --region "$AWS_REGION" --expires-in 7200)"

BASE_AMI="$(aws ec2 describe-images --region "$AWS_REGION" --owners 136693071363 \
  --filters Name=name,Values='debian-12-amd64-*' Name=architecture,Values=x86_64 \
  Name=virtualization-type,Values=hvm \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)"
ROOT_DEV="$(aws ec2 describe-images --region "$AWS_REGION" --image-ids "$BASE_AMI" \
  --query 'Images[0].RootDeviceName' --output text)"

cat > /tmp/apparatus-builder-userdata.sh <<EOF
#!/bin/bash
set -euxo pipefail
exec > >(tee /dev/console) 2>&1
curl -fsSL '$URL' -o /tmp/apparatus.tgz
mkdir -p /opt/apparatus
tar xzf /tmp/apparatus.tgz -C /opt/apparatus
rm -f /tmp/apparatus.tgz
bash /opt/apparatus/vm/setup.sh
cloud-init clean --logs || true
truncate -s 0 /etc/machine-id || true
rm -f /etc/ssh/ssh_host_*
shutdown -h now
EOF

ID="$(aws ec2 run-instances --region "$AWS_REGION" \
  --image-id "$BASE_AMI" \
  --instance-type t3.medium \
  --subnet-id "$SUBNET" \
  --security-group-ids "$SG" \
  --associate-public-ip-address \
  --user-data file:///tmp/apparatus-builder-userdata.sh \
  --instance-initiated-shutdown-behavior stop \
  --block-device-mappings "[{\"DeviceName\":\"$ROOT_DEV\",\"Ebs\":{\"VolumeSize\":50,\"VolumeType\":\"gp3\",\"DeleteOnTermination\":true}}]" \
  --metadata-options 'HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$BUILDER},{Key=apparatus,Value=builder}]" \
  --query 'Instances[0].InstanceId' --output text)"
echo "builder $ID" >&2

deadline=$((SECONDS + 2700))
state=""
while [ "$SECONDS" -lt "$deadline" ]; do
  state="$(aws ec2 describe-instances --region "$AWS_REGION" --instance-ids "$ID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)"
  echo "builder state: $state" >&2
  if [ "$state" = "stopped" ]; then
    break
  fi
  if [ "$state" = "terminated" ] || [ "$state" = "shutting-down" ]; then
    echo "builder $ID ended before the image was taken" >&2
    aws ec2 get-console-output --region "$AWS_REGION" --instance-id "$ID" --output text || true
    exit 1
  fi
  sleep 20
done
if [ "$state" != "stopped" ]; then
  echo "builder $ID did not stop within 45 minutes. It is still running." >&2
  aws ec2 get-console-output --region "$AWS_REGION" --instance-id "$ID" --output text || true
  exit 1
fi

IMAGE_ID="$(aws ec2 create-image --region "$AWS_REGION" --instance-id "$ID" \
  --name "apparatus-vm-$STAMP" --description "apparatus user VM" \
  --query 'ImageId' --output text)"
aws ec2 create-tags --region "$AWS_REGION" --resources "$IMAGE_ID" \
  --tags "Key=Name,Value=apparatus-vm-$STAMP" "Key=apparatus,Value=vm-image" >/dev/null
echo "waiting for $IMAGE_ID" >&2
image_deadline=$((SECONDS + 1800))
image_state=""
while [ "$SECONDS" -lt "$image_deadline" ]; do
  image_state="$(aws ec2 describe-images --region "$AWS_REGION" --image-ids "$IMAGE_ID" \
    --query 'Images[0].State' --output text)"
  if [ "$image_state" = "available" ]; then
    break
  fi
  if [ "$image_state" = "failed" ]; then
    echo "image $IMAGE_ID failed" >&2
    exit 1
  fi
  sleep 20
done
if [ "$image_state" != "available" ]; then
  echo "image $IMAGE_ID is $image_state after 30 minutes" >&2
  exit 1
fi

if aws ec2 describe-launch-templates --region "$AWS_REGION" \
  --launch-template-names apparatus-vm >/dev/null 2>&1; then
  aws ec2 create-launch-template-version --region "$AWS_REGION" \
    --launch-template-name apparatus-vm --source-version '$Latest' \
    --launch-template-data "{\"ImageId\":\"$IMAGE_ID\"}" >/dev/null
  aws ec2 modify-launch-template --region "$AWS_REGION" \
    --launch-template-name apparatus-vm --default-version '$Latest' >/dev/null
  echo "launch template apparatus-vm now uses $IMAGE_ID" >&2
fi
aws ec2 terminate-instances --region "$AWS_REGION" --instance-ids "$ID" >/dev/null
printf '%s\n' "$IMAGE_ID"
