#!/usr/bin/env bash
set -euo pipefail

readonly GITLEAKS_VERSION="8.30.1"
readonly GITLEAKS_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
readonly INSTALL_DIRECTORY="${RUNNER_TEMP:-$(mktemp -d)}/gitleaks-install"
readonly ARCHIVE_PATH="$INSTALL_DIRECTORY/gitleaks.tar.gz"

mkdir -p "$INSTALL_DIRECTORY"
curl --fail --location --silent --show-error \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
  --output "$ARCHIVE_PATH"
echo "$GITLEAKS_SHA256  $ARCHIVE_PATH" | sha256sum --check --status
sudo tar --extract --gzip --file "$ARCHIVE_PATH" --directory /usr/local/bin gitleaks
gitleaks version
