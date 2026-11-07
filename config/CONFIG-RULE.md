# Property Order in Configuration Files

This rule applies to all YAML configuration files in `config` and
`cli-template/.agents/skills/deploy/configs/_example`, such as `default.yaml` and `local.yaml`. These files use
YAML, a text format that represents settings as a tree of sections and properties. Whenever properties are added,
modified, or renamed, arrange them alphabetically within their nesting level: properties in a section form a single
ordered list, and each nested section is sorted in the same way, independently of the others.

Compare property names character by character, ignoring case, so `database` precedes `defaultRows`, and
`maxResultBytes` precedes `maxRows`. A comment above a property moves together with that property.
Only object properties are sorted; list elements retain their original order.

## Exceptions

- Place `enabled` first at its nesting level, followed by the remaining properties in alphabetical order.
- Write username and password pairs with the username first. If a property whose name starts with `user` (such as
  `user` or `username`) and a property whose name starts with `password` occur at the same level, place the username
  immediately before the password, at the password's alphabetical position. Alphabetical order alone places
  `password` before `user`; this exception reverses that pair.
- For database connection settings, use the following order (`enabled`, if present, still comes first):

```yaml
database: ~~~
host: ~~~
port: ~~~
user: ~~~
password: ~~~
<other settings in alphabetical order>
```

