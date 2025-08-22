# Security Policy

## Supported Versions

Currently supported versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within QueryGPT, please follow these steps:

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Send a detailed report to: security@querygpt.example.com
3. Include the following information:
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Resolution Timeline**: Depends on severity
  - Critical: 7-14 days
  - High: 14-30 days
  - Medium: 30-60 days
  - Low: 60-90 days

## Security Best Practices

### For Users

1. **Environment Variables**
   - Never commit `.env` files to version control
   - Use strong, unique API keys
   - Rotate credentials regularly

2. **Database Security**
   - Use read-only database accounts when possible
   - Enable SSL/TLS for database connections
   - Implement IP whitelisting

3. **API Security**
   - Always use HTTPS in production
   - Implement rate limiting
   - Use authentication tokens

### For Developers

1. **Code Security**
   - Review all SQL queries for injection vulnerabilities
   - Validate and sanitize all user inputs
   - Use parameterized queries

2. **Dependencies**
   - Regularly update dependencies
   - Run security audits with `pip-audit`
   - Monitor vulnerability databases

3. **Access Control**
   - Implement proper authentication
   - Use principle of least privilege
   - Log security events

## Security Features

QueryGPT includes several security features:

- **SQL Injection Protection**: All queries are validated and sanitized
- **Read-Only Mode**: Database operations are restricted to SELECT, SHOW, DESCRIBE
- **Rate Limiting**: Built-in protection against API abuse
- **Input Validation**: Strict validation of all user inputs
- **Secure Defaults**: Security-first configuration out of the box

## Disclosure Policy

- Security vulnerabilities will be disclosed after patches are available
- Users will be notified through GitHub Security Advisories
- A 30-day grace period will be provided before public disclosure

## Contact

For security concerns, please contact:
- Email: security@querygpt.example.com
- GPG Key: [Link to public key]

## Acknowledgments

We appreciate the security research community and will acknowledge researchers who responsibly disclose vulnerabilities.

Thank you for helping keep QueryGPT and its users safe!