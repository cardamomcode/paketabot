default:
    @just --list

setup:
    dotnet tool restore
    dotnet paket install
    pnpm install --frozen-lockfile

clean:
    pnpm clean

build:
    pnpm build

dev:
    pnpm dev

test:
    pnpm test

check:
    pnpm check

format:
    dotnet fantomas src test

db-up:
    podman compose up -d postgres

db-down:
    podman compose down

