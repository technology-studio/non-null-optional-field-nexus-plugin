# Non null optional field nexus plugin #

Non null optional field [nexus](https://nexusjs.org/) plugin adds runtime non null validation for `inputObjectType` fields.

## Reasoning

Graphql currently doesn't differentiate between nullable and optional types. So it's not possible to enforce non-null constrain on optional fields that are usually used in update mutations.

## Usage:

```
export const SomeInput = inputObjectType({
  name: 'SomeInput',
  definition(t) {
    t.nullable.string('some', { nonNullOptional: true })
  }
})
```
