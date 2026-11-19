#!/bin/sh
# Updates the Docker Hub repository description from docker/DOCKERHUB.md
# Requires DOCKERHUB_USERNAME and DOCKERHUB_TOKEN environment variables
# Generate a token at: https://hub.docker.com/settings/security

set -e

REPO="vibralabs/atrium"
README_FILE="$(dirname "$0")/../docker/DOCKERHUB.md"

if [ -z "$DOCKERHUB_USERNAME" ] || [ -z "$DOCKERHUB_TOKEN" ]; then
  echo "Set DOCKERHUB_USERNAME and DOCKERHUB_TOKEN environment variables"
  echo "Generate a token at: https://hub.docker.com/settings/security"
  exit 1
fi

# Get JWT token
# Built with jq rather than string interpolation: a credential containing a
# quote or a backslash would otherwise produce malformed JSON and report itself
# as "Failed to authenticate", which is the wrong thing to go looking for.
LOGIN_BODY=$(jq -n --arg user "$DOCKERHUB_USERNAME" --arg pass "$DOCKERHUB_TOKEN" \
  '{username: $user, password: $pass}')

TOKEN=$(curl -s -X POST "https://hub.docker.com/v2/users/login/" \
  -H "Content-Type: application/json" \
  --data-binary "$LOGIN_BODY" \
  | jq -r '.token')

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "Failed to authenticate with Docker Hub"
  exit 1
fi

# Update description
FULL_DESCRIPTION=$(cat "$README_FILE")

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "https://hub.docker.com/v2/repositories/$REPO/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- <<PAYLOAD
{
  "full_description": $(echo "$FULL_DESCRIPTION" | jq -Rs .)
}
PAYLOAD
)

if [ "$STATUS" = "200" ]; then
  echo "Docker Hub description updated successfully"
else
  echo "Failed to update Docker Hub description (HTTP $STATUS)"
  if [ "$STATUS" = "403" ]; then
    echo "403 means the credential authenticated but may not edit this repository."
    echo "Editing a description needs a token with read/write/delete scope, on an"
    echo "account that owns the namespace. Check https://hub.docker.com/settings/security"
  fi
  exit 1
fi
