# Installation rules

## Purpose

Describe the instance purpose, branch, service name and readiness URL. State whether routine updates include
database changes. Document restrictions on automatic updates, which run every minute inside the container.

## Server and network

Describe connection requirements, a free application port, domain, Caddy or nginx settings and external services.
Installations sharing a server need separate ports, domains, containers and persistent data directories.

## Recovery

Describe persistent data locations, recovery procedures and known failure causes. Do not include secret values.
