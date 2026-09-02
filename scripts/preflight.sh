#!/usr/bin/env sh
# Preflight check — run before `docker compose up -d`.
#
# Why this exists: docker-compose silently interpolates an undefined ${VAR} to
# the empty string. On 2026-09-02 that took production down. The mongo service
# declares a literal MONGO_INITDB_ROOT_USERNAME and a templated
# MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}; with MONGO_PASSWORD absent from
# .env, mongo saw one of the pair set and the other empty and refused to start —
# looping with:
#
#   error: missing 'MONGO_INITDB_ROOT_USERNAME' or 'MONGO_INITDB_ROOT_PASSWORD'
#          both must be specified for a user to be created
#
# Nothing validates that at build or deploy time, so the failure surfaces as a
# crash-looping database rather than a clear configuration error. This script
# turns it into a one-line message before any container is touched.
#
# Usage:  ./scripts/preflight.sh
# Exit:   0 = safe to deploy, 1 = fix the reported variables first.

set -eu

cd "$(dirname "$0")/.."

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
ENV_FILE=${ENV_FILE:-.env}

fail() {
  printf 'preflight: %s\n' "$1" >&2
  exit 1
}

[ -f "$COMPOSE_FILE" ] || fail "$COMPOSE_FILE not found — run this from the project root"
[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found — copy .env.example to .env and fill it in"

# Read a variable's value from the env file without sourcing it. Sourcing would
# break on values containing spaces, quotes or shell metacharacters, which
# passwords routinely do.
env_value() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
    | tail -n 1 \
    | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" \
    | tr -d '\r'
}

# Every ${VAR} (and ${VAR:-default}) referenced by the compose file.
REFS=$(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$COMPOSE_FILE" | sed 's/^\${//' | sort -u)

MISSING=''
for var in $REFS; do
  if [ -z "$(env_value "$var")" ]; then
    MISSING="$MISSING $var"
  fi
done

if [ -n "$MISSING" ]; then
  printf 'preflight: FAILED\n' >&2
  printf 'These variables are interpolated by %s but are empty or absent in %s.\n' \
    "$COMPOSE_FILE" "$ENV_FILE" >&2
  printf 'Compose substitutes an empty string, which is rarely what you want.\n\n' >&2
  for var in $MISSING; do
    printf '  %s\n' "$var" >&2
  done
  printf '\nSee .env.example for the full list.\n' >&2
  exit 1
fi

# Mongo credentials have to agree in two places: the root user compose creates
# and the URI the app connects with. They are separate values, so updating one
# after a rotation and not the other is the next outage in waiting.
MONGO_PASSWORD=$(env_value MONGO_PASSWORD)
MONGODB_URI=$(env_value MONGODB_URI)

if [ -n "$MONGODB_URI" ] && [ -n "$MONGO_PASSWORD" ]; then
  # Passwords containing reserved characters are percent-encoded in the URI, so
  # accept that form too. Only characters that are actually illegal in the
  # userinfo component are encoded — sub-delims like ! $ & ' ( ) * + , ; = are
  # legal there and are left alone so an ordinary password still matches as-is.
  MONGO_PASSWORD_ENC=$(printf '%s' "$MONGO_PASSWORD" \
    | sed -e 's/%/%25/g' -e 's/@/%40/g' -e 's/:/%3A/g' -e 's|/|%2F|g' \
          -e 's/?/%3F/g' -e 's/#/%23/g' -e 's/\[/%5B/g' -e 's/\]/%5D/g')

  case "$MONGODB_URI" in
    *"${MONGO_PASSWORD}"*) ;;
    *"${MONGO_PASSWORD_ENC}"*) ;;
    *)
      printf 'preflight: FAILED\n' >&2
      printf 'MONGODB_URI does not contain MONGO_PASSWORD.\n' >&2
      printf 'The app would authenticate with a different password than the one\n' >&2
      printf 'compose provisions on the database. Update both together.\n' >&2
      printf 'If the password contains reserved characters, percent-encode them\n' >&2
      printf 'in MONGODB_URI (%s)\n' "$MONGO_PASSWORD_ENC" >&2
      exit 1
      ;;
  esac
fi

printf 'preflight: OK — all %s variables resolved from %s\n' \
  "$(echo "$REFS" | wc -w | tr -d ' ')" "$ENV_FILE"
