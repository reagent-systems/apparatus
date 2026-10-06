#!/usr/bin/env bash
# Point the ECS service at IMAGE. Terraform must already have created the service.
set -euo pipefail
: "${AWS_REGION:?}" "${IMAGE:?}"
CLUSTER="${ECS_CLUSTER:-apparatus}"
SERVICE="${ECS_SERVICE:-apparatus-server}"
TASK="$(aws ecs describe-services --region "$AWS_REGION" --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text)"
if [ -z "$TASK" ] || [ "$TASK" = "None" ]; then
  echo "no ECS service $SERVICE. Apply deploy/aws with server_image set." >&2
  exit 1
fi
aws ecs describe-task-definition --region "$AWS_REGION" --task-definition "$TASK" \
  --query 'taskDefinition' > /tmp/apparatus-taskdef.json
jq --arg IMAGE "$IMAGE" '
  .containerDefinitions |= map(if .name == "server" then .image = $IMAGE else . end)
  | del(
      .taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
      .registeredAt, .registeredBy, .deregisteredAt
    )
' /tmp/apparatus-taskdef.json > /tmp/apparatus-taskdef.new.json
NEW="$(aws ecs register-task-definition --region "$AWS_REGION" \
  --cli-input-json file:///tmp/apparatus-taskdef.new.json \
  --query 'taskDefinition.taskDefinitionArn' --output text)"
aws ecs update-service --region "$AWS_REGION" --cluster "$CLUSTER" --service "$SERVICE" \
  --task-definition "$NEW" > /dev/null
echo "service $SERVICE -> $IMAGE"
