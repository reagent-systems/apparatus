variable "region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "api_domain" {
  type        = string
  default     = ""
  description = "Hostname mapped to the load balancer. Empty uses the load balancer DNS name."
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate for HTTPS. Empty serves HTTP on port 80."
}

variable "server_image" {
  type        = string
  default     = ""
  description = "ECR image for the session server. Empty skips the ECS service so the first apply can create the repository."
}

variable "server_cpu" {
  type    = number
  default = 1024
}

variable "server_memory" {
  type    = number
  default = 2048
}

variable "server_desired_count" {
  type    = number
  default = 1
}

variable "auth_mode" {
  type    = string
  default = "firebase"
  validation {
    condition     = contains(["firebase", "dev"], var.auth_mode)
    error_message = "auth_mode is firebase or dev."
  }
}

variable "firebase_project_id" {
  type        = string
  default     = ""
  description = "Audience for firebase auth. Required when auth_mode is firebase."
}

variable "gemini_api_key" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Gemini key. Empty runs the fake model. The value is stored in Secrets Manager."
}

variable "vm_ami_id" {
  type        = string
  default     = ""
  description = "AMI from build-vm-image.sh. Empty leaves the launch template without an image."
}

variable "vm_instance_type" {
  type    = string
  default = "t3.large"
}

variable "vm_disk_gb" {
  type    = number
  default = 50
}

variable "vm_root_device" {
  type    = string
  default = "/dev/xvda"
}

variable "turn_instance_type" {
  type    = string
  default = "t3.small"
}
