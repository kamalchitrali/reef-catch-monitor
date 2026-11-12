# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected security vulnerability or disclose private catch data, credentials, reset tokens, database files, or uploaded photographs.

Contact the repository owner privately through their GitHub profile with:

- the affected component and version or commit;
- steps to reproduce the issue;
- the potential impact;
- any suggested mitigation.

Do not test against an installation you do not own or have explicit authorization to assess.

## Deployment expectations

Production installations must use HTTPS, private environment-variable storage, configured SMTP delivery, restricted database access, and encrypted backups with tested restores. Never enable `REEF_DEV_SHOW_RESET_TOKEN` outside local development.
