variable "project" { type = string }
variable "region" {
  type    = string
  default = "us-central1"
}
variable "zone" {
  type    = string
  default = "us-central1-a"
}
variable "firestore_location" {
  type    = string
  default = "nam5"
}
variable "api_domain" {
  type        = string
  description = "Domain mapped to the Cloud Run service, for example api.example.com"
}
variable "server_image" {
  type        = string
  description = "Artifact Registry image for the session server"
}
variable "vm_image_family" {
  type    = string
  default = "apparatus-vm"
}
variable "vm_machine_type" {
  type    = string
  default = "e2-standard-2"
}
variable "vm_disk_gb" {
  type    = number
  default = 50
}
variable "vm_enroll_secret" {
  type      = string
  sensitive = true
}
variable "turn_secret" {
  type      = string
  sensitive = true
}
