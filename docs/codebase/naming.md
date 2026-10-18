# Naming

How to name variables, functions, types and anything else the code refers to. One test covers every name: reading only the name where it is used, without its type or declaration, a reader can say what it holds or does.

- When in doubt, pick the longer name; leave out only what the enclosing scope already says.
- Name a value after what it holds, not only after which variant it is.
- Name a function after what it returns, or after what it does and to what.
- Phrase a boolean as an assertion about a named subject, and name a function returning one after the comparison it makes.
- Name a keyed collection after its key with `By`: `messages` is a list, `messageByUuid` a map.
- Never let one word name two different things, nor one thing go by two words. A domain concept takes its `GLOSSARY.md` term, never a synonym listed under its _Avoid_.
- Give a primitive domain concept a type alias in the module that owns it, with the unit in the alias name (`type CostInUsd = number`).
- Exempt from these rules: a callback parameter named after one element of the collection iterated on the same line, and framework conventions (`prisma` for the `PrismaClient`, `ref`, `cn`).
- Never take names already in the code as ground truth: rename a weak name your change touches or extends in the same change.
