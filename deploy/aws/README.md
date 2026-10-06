# AWS deployment

The session server runs on Fargate. Each user has one EC2 desktop. A TURN
instance carries the screen stream. This folder is the Terraform and the
scripts the deploy workflow runs.

| Part | Resource | File |
|---|---|---|
| Network | VPC, public and private subnets, one NAT gateway | `main.tf` |
| User VM | Launch template, empty instance role, IMDSv2, daily snapshots | `main.tf`, `provision-vm.sh` |
| VM image | Debian 12, desktop, agentd, built by `vm/setup.sh` | `build-vm-image.sh` |
| Session server | ECS Fargate, application load balancer, idle timeout 3600 s | `main.tf` |
| Image registry | ECR `apparatus-server` | `main.tf`, `push-server.sh` |
| Secrets | Gemini key, enroll secret, TURN secret in Secrets Manager | `main.tf` |
| State | File store on EFS (`APPARATUS_STORE=file`) | `main.tf` |
| Login | Firebase ID tokens. The project id is a variable. | `main.tf` |
| Push | `log`. FCM still reads a GCE metadata token. | `main.tf` |
| Screen stream | coturn on a t3.small with an elastic IP | `main.tf`, `turn-user-data.sh.tftpl` |
| Entry | Load balancer DNS name, or `api_domain` when you set it | `outputs.tf` |

## First deployment

1. Install Terraform 1.6 or newer and the AWS CLI. Point them at the account.
2. From `deploy/aws`, run `terraform init`.
3. Run `terraform apply`. Set `firebase_project_id`. Leave `server_image` empty on this pass.
4. From the repo root, run `AWS_REGION=us-east-1 deploy/aws/push-server.sh`. Copy the image URI.
5. Run `terraform apply -var server_image=THAT_URI -var firebase_project_id=YOUR_PROJECT`.
6. Pass `-var gemini_api_key=...` on that apply when you have a key. An empty key runs the fake model.
7. Run `AWS_REGION=us-east-1 deploy/aws/build-vm-image.sh`. Copy the AMI id.
8. Run `terraform apply -var vm_ami_id=THAT_AMI` with the same server image variable.
9. Run `AWS_REGION=us-east-1 deploy/aws/provision-vm.sh USER_ID`.

`deploy-server.sh` rolls a new image onto an ECS service that already exists.
The build script sets the launch template image when the template exists.

## Rules

- The VM security group has no inbound rule.
- VM egress allows TCP 80 and 443, UDP 53, TCP 53 to the VPC resolver, UDP 123 and UDP 3478.
- The VM has no path to the server task, to EFS, or to another VM. It calls the public URL through NAT.
- IMDSv2 is required. The hop limit is 1. `vm/setup.sh` rejects `169.254.169.254` for every uid except root.
- The VM instance role has no policies. Only the task role can start and stop instances tagged `apparatus=vm`.
- The Gemini key is a Secrets Manager value on the task. It is not in the VM.
- Snapshots run daily and keep 14 copies of volumes tagged `apparatus=vm`.
- Login stays Firebase. The server fetches Google's certificates over HTTPS.
- `auth_mode=dev` trusts the bearer token as the user id. Use that mode on a private network only.
- Terraform state holds the enroll secret and the TURN secret. Keep the state file private.
- A browser microphone needs HTTPS. Set `certificate_arn` and point `api_domain` at the load balancer.
- Apply creates a NAT gateway, a load balancer, a Fargate service and a TURN instance. Billing starts then.
- A stopped user VM keeps its disk (`delete_on_termination` is false).

## GitHub Actions

`.github/workflows/deploy-aws.yml` runs when the repository variable `AWS_DEPLOY_ROLE_ARN` is set.
Set `AWS_REGION` too. The role needs ECR push, ECS service update, EC2 image build, and `s3:PutObject` on the build bucket.
Image builds also need `AWS_BUILD_BUCKET`, `AWS_BUILDER_SUBNET` and `AWS_BUILDER_SG`. Those values are terraform outputs.
