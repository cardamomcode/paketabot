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

bundle:
    pnpm bundle

dev:
    pnpm dev

test:
    pnpm test

check:
    pnpm check

format:
    dotnet fantomas src test
