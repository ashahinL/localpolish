# Security

## Reporting a problem

If you find a security or privacy problem in LocalPolish, please report it
privately first:

- **GitHub:** open a private report from this repository's **Security** tab
  (**Report a vulnerability**).

Say what you found, how to reproduce it, and which version you use (the
popup's **About** tab shows it at the bottom). Please don't open a public
issue for it until a fix is out.

## What counts

- Anything that lets a web page read or change the extension's settings or
  API keys, saved chats, or pending attachments, or read password values or unrelated field text.
- Anything that sends your text somewhere other than the provider you chose,
  or sends it when you did not ask, outside the documented Fix while I type behavior. Automatic checks and the selection sparkle must stay off on blocked sites. Explicit chat and rewrite actions remain available there.
- Anything that lets a page, another extension or another program use the
  bridge to run something other than the chosen CLI, or to run that CLI with
  its tools on.

A bug that only breaks a feature, with no data exposed, is a normal issue.

## Supported versions

Only the latest [GitHub release](https://github.com/ashahinL/localpolish/releases/latest)
gets fixes.
