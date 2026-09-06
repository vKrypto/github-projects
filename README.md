# github-projects

All personal repos, tracked here as git submodules.

| Repo | Description |
| --- | --- |
| [ai-based-repo-template](https://github.com/vKrypto/ai-based-repo-template) | Template repo for bootstrapping new projects with shared Claude Code config, skills, and rules. |
| [barebrilliant](https://github.com/vKrypto/barebrilliant) | Interactive lead-capture form for a jewellery brand — React (Vite) client, Express server, optional Firestore. |
| [invoice-extraction](https://github.com/vKrypto/invoice-extraction) | Databricks pipeline for invoice PDF/OCR processing, LLM extraction, vendor validation, and Delta/Kafka posting. |
| [job-seeker](https://github.com/vKrypto/job-seeker) | GetInterviewed — an interview-prep/job-seeking app, deployable on a 1 GB RAM host. |
| [local-server](https://github.com/vKrypto/local-server) | Home network build-out docs — Omada LAN, NetworkEye monitoring, Reception (DNS/NTP), Proxmox Docker Swarm workloads. |
| [mini-server](https://github.com/vKrypto/mini-server) | Serverless event-tracking API on AWS — API Gateway, Lambda, DynamoDB, WAF, all Terraform + Python. |
| [self-hosting](https://github.com/vKrypto/self-hosting) | Collection of docker-compose stacks used in videos on the RoKeTech YouTube channel. |
| [setup-system-main](https://github.com/vKrypto/setup-system) | Ubuntu install script for a full dev/Docker setup (`install.sh`/`setup.sh`), with or without Docker Desktop. |
| [switchwale](https://github.com/vKrypto/switchwale) | Static marketing/landing site for SwitchWale (React + Vite), independent from the main app. |
| [vKrypto](https://github.com/vKrypto/vKrypto) | Personal GitHub profile README. |

## Cloning

```sh
git clone --recurse-submodules https://github.com/vKrypto/github-projects.git
```

Already cloned without `--recurse-submodules`?

```sh
git submodule update --init --recursive
```
