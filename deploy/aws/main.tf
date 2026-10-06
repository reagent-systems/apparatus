# apparatus on AWS. Same rules as deploy/gcp: the user VM dials out, has no
# inbound ports, and its instance role has no policies. The API key stays on
# the session server.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "apparatus" }
  }
}

check "firebase_project" {
  assert {
    condition     = var.auth_mode != "firebase" || var.firebase_project_id != ""
    error_message = "Set firebase_project_id, or set auth_mode to dev."
  }
}

check "fargate_size" {
  assert {
    condition = (
      var.server_cpu == 1024 && var.server_memory >= 2048 && var.server_memory <= 8192
      ) || (
      var.server_cpu == 2048 && var.server_memory >= 4096 && var.server_memory <= 16384
    )
    error_message = "Fargate needs 1024 CPU with 2048-8192 MB, or 2048 CPU with 4096-16384 MB."
  }
}

data "aws_availability_zones" "available" {
  state = "available"
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_ami" "debian" {
  most_recent = true
  owners      = ["136693071363"] # Debian cloud images
  filter {
    name   = "name"
    values = ["debian-12-amd64-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

locals {
  az_a      = data.aws_availability_zones.available.names[0]
  az_b      = data.aws_availability_zones.available.names[1]
  scheme    = var.certificate_arn == "" ? "http" : "https"
  ws_scheme = var.certificate_arn == "" ? "ws" : "wss"
  vpc_dns   = "${cidrhost(var.vpc_cidr, 2)}/32"
}

resource "random_password" "enroll" {
  length  = 32
  special = false
}

resource "random_password" "turn" {
  length  = 32
  special = false
}

# ---------------------------------------------------------------------------
# Network. User VMs have no public address. Egress goes through one NAT
# gateway. Their security group is an allow-list: web, DNS, NTP and TURN.
# It has no rule toward the rest of the VPC, so a VM cannot reach the server
# task, the file system, or another VM.
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "apparatus" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "apparatus" }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 0)
  availability_zone       = local.az_a
  map_public_ip_on_launch = true
  tags                    = { Name = "apparatus-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone       = local.az_b
  map_public_ip_on_launch = true
  tags                    = { Name = "apparatus-public-b" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, 1)
  availability_zone = local.az_a
  tags              = { Name = "apparatus-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, 2)
  availability_zone = local.az_b
  tags              = { Name = "apparatus-private-b" }
}

resource "aws_subnet" "vm" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, 3)
  availability_zone = local.az_a
  tags              = { Name = "apparatus-vms" }
}

resource "aws_eip" "nat" {
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]
  tags       = { Name = "apparatus-nat" }
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public_a.id
  tags          = { Name = "apparatus-nat" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "apparatus-public" }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.nat.id
  }
  tags = { Name = "apparatus-private" }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private_a" {
  subnet_id      = aws_subnet.private_a.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "private_b" {
  subnet_id      = aws_subnet.private_b.id
  route_table_id = aws_route_table.private.id
}

resource "aws_route_table_association" "vm" {
  subnet_id      = aws_subnet.vm.id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "vm" {
  name        = "apparatus-vm"
  description = "User VMs. No inbound. Egress is web, DNS, NTP and TURN."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "https"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "http"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "dns"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "vpc resolver"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = [local.vpc_dns]
  }
  egress {
    description = "ntp"
    from_port   = 123
    to_port     = 123
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "turn"
    from_port   = 3478
    to_port     = 3478
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "apparatus-vm" }
}

resource "aws_security_group" "builder" {
  name        = "apparatus-builder"
  description = "Short-lived image builder. No inbound."
  vpc_id      = aws_vpc.main.id

  egress {
    description = "https"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "http"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "dns"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "apparatus-builder" }
}

# ---------------------------------------------------------------------------
# User VMs. One launch template. provision-vm.sh launches one instance per
# user. The instance role can be assumed and can do nothing else.
# IMDSv2 is required and the hop limit is 1. vm/setup.sh also rejects
# metadata for every user except root.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "vm" {
  name = "apparatus-vm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_instance_profile" "vm" {
  name = "apparatus-vm"
  role = aws_iam_role.vm.name
}

resource "aws_launch_template" "vm" {
  name                   = "apparatus-vm"
  update_default_version = true
  image_id               = var.vm_ami_id != "" ? var.vm_ami_id : null
  instance_type          = var.vm_instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.vm.name
  }

  network_interfaces {
    associate_public_ip_address = false
    security_groups             = [aws_security_group.vm.id]
    subnet_id                   = aws_subnet.vm.id
    device_index                = 0
  }

  block_device_mappings {
    device_name = var.vm_root_device
    ebs {
      volume_size           = var.vm_disk_gb
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = false
    }
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "enabled"
  }

  user_data = base64encode(templatefile("${path.module}/vm-user-data.sh.tftpl", {
    server_url    = "${local.ws_scheme}://${local.public_host}/ws/agentd"
    enroll_secret = random_password.enroll.result
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      apparatus = "vm"
    }
  }
  tag_specifications {
    resource_type = "volume"
    tags = {
      apparatus = "vm"
    }
  }

  tags = { Name = "apparatus-vm" }
}

resource "aws_iam_role" "dlm" {
  name = "apparatus-dlm"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "vm" {
  description        = "Daily snapshots of apparatus user VM disks kept 14 days"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { apparatus = "vm" }

    schedule {
      name = "daily"
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:00"]
      }
      retain_rule {
        count = 14
      }
      copy_tags = true
    }
  }

  depends_on = [aws_iam_role_policy_attachment.dlm]
  tags       = { Name = "apparatus-vm-snapshots" }
}

# ---------------------------------------------------------------------------
# Session server. Fargate keeps CPU for the agent loop. The load balancer
# holds a WebSocket for an hour. An empty server_image skips the service so
# the first apply can create the repository.
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "server" {
  name         = "apparatus-server"
  force_delete = true
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/apparatus/server"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "main" {
  name = "apparatus"
}

resource "aws_iam_role" "exec" {
  name = "apparatus-server-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "exec" {
  role       = aws_iam_role.exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "exec_secrets" {
  name = "secrets"
  role = aws_iam_role.exec.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.gemini.arn,
        aws_secretsmanager_secret.enroll.arn,
        aws_secretsmanager_secret.turn.arn,
      ]
    }]
  })
}

resource "aws_iam_role" "task" {
  name = "apparatus-server-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "task" {
  name = "vm-power"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "PowerTaggedVms"
        Effect   = "Allow"
        Action   = ["ec2:StartInstances", "ec2:StopInstances"]
        Resource = "arn:aws:ec2:${var.region}:*:instance/*"
        Condition = {
          StringEquals = { "ec2:ResourceTag/apparatus" = "vm" }
        }
      },
      {
        # DescribeInstances does not accept a resource limit.
        Sid      = "DescribeInstances"
        Effect   = "Allow"
        Action   = ["ec2:DescribeInstances"]
        Resource = "*"
      },
      {
        Sid      = "DataVolume"
        Effect   = "Allow"
        Action   = ["elasticfilesystem:ClientMount", "elasticfilesystem:ClientWrite"]
        Resource = aws_efs_file_system.data.arn
        Condition = {
          StringEquals = { "elasticfilesystem:AccessPointArn" = aws_efs_access_point.data.arn }
        }
      },
    ]
  })
}

resource "aws_efs_file_system" "data" {
  encrypted = true
  tags      = { Name = "apparatus-data" }
}

resource "aws_efs_access_point" "data" {
  file_system_id = aws_efs_file_system.data.id
  posix_user {
    uid = 0
    gid = 0
  }
  root_directory {
    path = "/apparatus"
    creation_info {
      owner_uid   = 0
      owner_gid   = 0
      permissions = "0755"
    }
  }
}

resource "aws_security_group" "efs" {
  name        = "apparatus-efs"
  description = "NFS from the session server"
  vpc_id      = aws_vpc.main.id
  ingress {
    description     = "nfs"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.server.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "apparatus-efs" }
}

resource "aws_efs_mount_target" "data" {
  for_each = {
    a = aws_subnet.private_a.id
    b = aws_subnet.private_b.id
  }
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = each.value
  security_groups = [aws_security_group.efs.id]
}

resource "aws_security_group" "alb" {
  name        = "apparatus-alb"
  description = "Public entry to the session server"
  vpc_id      = aws_vpc.main.id
  ingress {
    description = "http"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "https"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "apparatus-alb" }
}

resource "aws_security_group" "server" {
  name        = "apparatus-server"
  description = "Session server tasks"
  vpc_id      = aws_vpc.main.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "apparatus-server" }
}

resource "aws_vpc_security_group_ingress_rule" "server_from_alb" {
  security_group_id            = aws_security_group.server.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
  description                  = "load balancer"
}

resource "aws_lb" "server" {
  name                       = "apparatus-server"
  load_balancer_type         = "application"
  internal                   = false
  subnets                    = [aws_subnet.public_a.id, aws_subnet.public_b.id]
  security_groups            = [aws_security_group.alb.id]
  idle_timeout               = 3600
  drop_invalid_header_fields = true
  tags                       = { Name = "apparatus-server" }
}

resource "aws_lb_target_group" "server" {
  name        = "apparatus-server"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 86400
  }
  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http_forward" {
  count             = var.certificate_arn == "" ? 1 : 0
  load_balancer_arn = aws_lb.server.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.server.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = var.certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.server.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.server.arn
  }
}

locals {
  public_host = var.api_domain != "" ? var.api_domain : aws_lb.server.dns_name
  server_env = concat(
    [
      { name = "APPARATUS_AUTH_MODE", value = var.auth_mode },
      { name = "APPARATUS_VM_CONTROLLER", value = "ec2" },
      { name = "EC2_REGION", value = var.region },
      { name = "APPARATUS_PUSH", value = "log" },
      { name = "APPARATUS_STORE", value = "file" },
      { name = "APPARATUS_DATA_DIR", value = "/data" },
      { name = "APPARATUS_TURN_URL", value = "turn:${aws_eip.turn.public_ip}:3478?transport=udp" },
    ],
    var.auth_mode == "firebase" ? [{ name = "FIREBASE_PROJECT_ID", value = var.firebase_project_id }] : [],
  )
  server_secrets = concat(
    [
      { name = "APPARATUS_VM_ENROLL_SECRET", valueFrom = aws_secretsmanager_secret.enroll.arn },
      { name = "APPARATUS_TURN_SECRET", valueFrom = aws_secretsmanager_secret.turn.arn },
    ],
    var.gemini_api_key == "" ? [] : [
      { name = "GEMINI_API_KEY", valueFrom = aws_secretsmanager_secret.gemini.arn },
    ],
  )
}

resource "aws_ecs_task_definition" "server" {
  count                    = var.server_image == "" ? 0 : 1
  family                   = "apparatus-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.server_cpu)
  memory                   = tostring(var.server_memory)
  execution_role_arn       = aws_iam_role.exec.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name      = "server"
    image     = var.server_image
    essential = true
    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]
    environment = local.server_env
    secrets     = local.server_secrets
    mountPoints = [{
      sourceVolume  = "data"
      containerPath = "/data"
      readOnly      = false
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.server.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "server"
      }
    }
  }])

  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.data.id
        iam             = "ENABLED"
      }
    }
  }

  depends_on = [
    aws_secretsmanager_secret_version.enroll,
    aws_secretsmanager_secret_version.turn,
    aws_secretsmanager_secret_version.gemini,
  ]
}

resource "aws_ecs_service" "server" {
  count                              = var.server_image == "" ? 0 : 1
  name                               = "apparatus-server"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.server[0].arn
  desired_count                      = var.server_desired_count
  launch_type                        = "FARGATE"
  platform_version                   = "1.4.0"
  health_check_grace_period_seconds  = 120
  enable_execute_command             = false
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_groups  = [aws_security_group.server.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = 8080
  }

  depends_on = [
    aws_lb_listener.http_forward,
    aws_lb_listener.https,
    aws_nat_gateway.nat,
    aws_efs_mount_target.data,
    aws_iam_role_policy_attachment.exec,
  ]
}

# ---------------------------------------------------------------------------
# Secrets. The Gemini key is optional. The enroll secret and the TURN secret
# are generated here. State holds them; keep the state private.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "gemini" {
  name                    = "apparatus/gemini-api-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "gemini" {
  count         = var.gemini_api_key == "" ? 0 : 1
  secret_id     = aws_secretsmanager_secret.gemini.id
  secret_string = var.gemini_api_key
}

resource "aws_secretsmanager_secret" "enroll" {
  name                    = "apparatus/vm-enroll-secret"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "enroll" {
  secret_id     = aws_secretsmanager_secret.enroll.id
  secret_string = random_password.enroll.result
}

resource "aws_secretsmanager_secret" "turn" {
  name                    = "apparatus/turn-secret"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "turn" {
  secret_id     = aws_secretsmanager_secret.turn.id
  secret_string = random_password.turn.result
}

# ---------------------------------------------------------------------------
# TURN relay. WebRTC needs UDP, which the load balancer does not carry.
# The instance has no role. external-ip is the elastic IP: the guest only
# sees the private address.
# ---------------------------------------------------------------------------

resource "aws_eip" "turn" {
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]
  tags       = { Name = "apparatus-turn" }
}

resource "aws_security_group" "turn" {
  name        = "apparatus-turn"
  description = "TURN relay. UDP 3478 and the relay range."
  vpc_id      = aws_vpc.main.id
  ingress {
    description = "turn"
    from_port   = 3478
    to_port     = 3478
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "turn tcp"
    from_port   = 3478
    to_port     = 3478
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "relay"
    from_port   = 49152
    to_port     = 65535
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "http"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "https"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "relay and dns"
    from_port   = 0
    to_port     = 65535
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "apparatus-turn" }
}

resource "aws_instance" "turn" {
  ami                         = data.aws_ami.debian.id
  instance_type               = var.turn_instance_type
  subnet_id                   = aws_subnet.public_a.id
  vpc_security_group_ids      = [aws_security_group.turn.id]
  associate_public_ip_address = true
  private_ip                  = cidrhost(aws_subnet.public_a.cidr_block, 20)
  user_data = templatefile("${path.module}/turn-user-data.sh.tftpl", {
    turn_secret = random_password.turn.result
    realm       = local.public_host
    public_ip   = aws_eip.turn.public_ip
    private_ip  = cidrhost(aws_subnet.public_a.cidr_block, 20)
  })
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
  root_block_device {
    volume_size = 10
    volume_type = "gp3"
    encrypted   = true
  }
  tags = { Name = "apparatus-turn" }
}

resource "aws_eip_association" "turn" {
  instance_id   = aws_instance.turn.id
  allocation_id = aws_eip.turn.id
}

# ---------------------------------------------------------------------------
# Image builds. The builder has no role. build-vm-image.sh uploads a tarball
# and passes a presigned URL in user-data.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "build" {
  bucket_prefix = "apparatus-vm-build-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "build" {
  bucket                  = aws_s3_bucket.build.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "build" {
  bucket = aws_s3_bucket.build.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "build" {
  bucket = aws_s3_bucket.build.id
  rule {
    id     = "expire-builds"
    status = "Enabled"
    filter {}
    expiration {
      days = 7
    }
  }
}

resource "aws_s3_bucket_policy" "build" {
  bucket = aws_s3_bucket.build.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.build.arn,
        "${aws_s3_bucket.build.arn}/*",
      ]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}
