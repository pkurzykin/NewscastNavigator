#!/usr/bin/env bash
set -euo pipefail

# Install root-owned (0755) as the forced command for the separate
# newscast-prune SSH key. Do not grant this account a general shell or read
# access to production backup contents.
[[ $# -eq 0 && ${SSH_ORIGINAL_COMMAND:-} == prune ]] || exit 2
exec /usr/bin/sudo -n -- /usr/local/sbin/newscast-vds-prune
