### Moved to https://github.com/ecomplus/app-tiny-erp

# app-tiny

[![CodeFactor](https://www.codefactor.io/repository/github/ecomplus/app-tiny/badge)](https://www.codefactor.io/repository/github/ecomplus/app-tiny)

E-Com Plus app to integrate Tiny ERP

#####  Environment variables

Env | Val
---------|--------
ECOMCLIENT_NOTIMEOUT  | `true`
ECOM_AUTH_DB  | `~/app/db/tiny.sqlite`
LOGGER_OUTPUT  | `~/app/log/logger.out`
LOGGER_ERRORS  | `~/app/log/logger.err`
LOGGER_FATAL_ERRORS | `~/app/log/_stderr`
PORT | `3000`
DB_NAME  | `tiny`
DB_HOST  | `localhost`
DB_USER  | `who`
DB_PASS | `secret`

## Production server

Published at https://tiny.ecomplus.biz

### Continuous deployment

When app version is **production ready**,
[create a new release](https://github.com/ecomclub/app-tiny/releases)
to run automatic deploy from `master` branch.
