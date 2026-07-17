# Cosmos Shop

E-commerce platform built on [High6 Medusa Omnichannel Template](https://github.com/high6/high6-medusa-commerce) `v1.0.0`.

Medusa 2.x — Turbo monorepo with backend and storefront.

## Getting Started

```bash
npm install
npm run dev              # Start all apps (turbo dev)
```

## Template Updates

This project is forked from the High6 Medusa template. To pull upstream updates, follow the procedure in **[TEMPLATE_SYNC.md](TEMPLATE_SYNC.md)**.

Client-owned files (role definitions, UI widgets, translations, env) are protected by `.gitattributes` and will never be overwritten by a template pull. See **[TEMPLATE_BOUNDARY.md](TEMPLATE_BOUNDARY.md)** for the full ownership list.

## What's Included

- **RBAC:** 8 roles with deny-by-default enforcement, sidebar + delete-action hiding
- **Tenant isolation:** Product, Sales Channel, Stock Location, Promotion, Campaign, Price List, Return Reason + Cart/Order guards
- **Marketplace orders:** External order creation from platforms like Shopee, Lazada

See the [template README](https://github.com/high6/high6-medusa-commerce) for full architecture details.
