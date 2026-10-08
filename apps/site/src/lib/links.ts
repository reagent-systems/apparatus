// Every link off the site. Each points at a path on main after the monorepo
// merge: the monorepo paths (apps/, infra/) reach main with the site, in the
// same merge. Until then LOCAL, GCP and APPS answer 404 there; check all of
// them after that merge.
export const REPO = "https://github.com/reagent-systems/apparatus";
export const RELEASES = `${REPO}/releases`;
export const SETUP = `${REPO}#run-it-locally`;
export const LOCAL = `${REPO}/blob/main/infra/local/docker-compose.yml`;
export const GCP = `${REPO}/tree/main/infra/gcp`;
export const APPS = `${REPO}/blob/main/apps/README.md`;
export const STATUS = `${REPO}/blob/main/agent-kit/STATUS.md`;
export const ROADMAP = `${REPO}/blob/main/agent-kit/ROADMAP.md`;
export const ARCHITECTURE = `${REPO}/blob/main/agent-kit/docs/ARCHITECTURE.md`;
export const MEDIA_README = `${REPO}/blob/main/docs/media/README.md`;
