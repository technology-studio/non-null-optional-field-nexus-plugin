/**
 * @Author: Rostislav Simonik <rostislav.simonik@technologystudio.sk>
 * @Date: 2021-07-29T09:07:75+02:00
 * @Copyright: Technology Studio
**/

import {
  getNamedType,
  GraphQLFieldConfigArgumentMap,
  GraphQLInputType,
  isInputObjectType,
  isListType,
  isNonNullType,
  isNamedType,
} from 'graphql'
import set from 'lodash.set'
import { GraphQLNamedInputType, NexusInputFieldDef } from 'nexus/dist/core'
import { NexusPlugin, plugin } from 'nexus/dist/plugin'
import { printedGenTyping } from 'nexus/dist/utils'

const DeclarativeNonNullOptional = [
  printedGenTyping({
    name: 'nonNullOptional',
    type: 'boolean',
    optional: true,
    description: 'Enforce to be non null value but optional (undefined)',
  }),
]

type ValidationConfig = {
  nonNullOptional?: boolean,
}

type ValidationType = {
  fields?: { [key: string]: ValidationField },
}

type ValidationField = {
  config?: ValidationConfig,
  type: ValidationType,
}

type ErrorMap = {
  [key: string]: ErrorMap | null,
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validate = (value: any, validationType: ValidationType | undefined, path: string[], errorMap: ErrorMap): void => {
  if (value && validationType) {
    if (Array.isArray(value)) {
      value.forEach((subValue, index) => validate(subValue, validationType, [...path, index.toString()], errorMap))
    } else if (typeof value === 'object') {
      Object.keys(value).forEach(key => {
        const subValue = value[key]
        const subValidationField = validationType.fields?.[key]
        const subPath = [...path, key]
        if (subValue === null && subValidationField?.config?.nonNullOptional) {
          set(errorMap, subPath, null)
        }
        validate(subValue, subValidationField?.type, subPath, errorMap)
      })
    }
  }
}

type ValidationMapper = (type: GraphQLInputType, validationType: ValidationType) => ValidationType

export const nonNullOptionalFieldPlugin = (): NexusPlugin => {
  const validationTypeCache: Record<string, ValidationType> = {}

  const cacheEnhancer = (mapper: ValidationMapper) => (type: GraphQLInputType): ValidationType => {
    if (isNamedType(type)) {
      if (type.name in validationTypeCache) {
        return validationTypeCache[type.name]
      }
      const validationNode: ValidationType = {}
      validationTypeCache[type.name] = validationNode
      return mapper(type, validationNode)
    }

    return mapper(type, {})
  }

  const getValidationType = cacheEnhancer(
    (type, validationType) => {
      if (isListType(type) || isNonNullType(type)) {
        return getValidationType(getNamedType(type) as GraphQLNamedInputType)
      }
      if (isInputObjectType(type)) {
        const inputFieldMap = type.getFields()
        const inputFieldKeyList = Object.keys(inputFieldMap).filter(key => (
          inputFieldMap[key].extensions?.nexus?.config?.nonNullOptional
        ))
        if (inputFieldKeyList.length > 0) {
          const fields: { [key: string]: ValidationField } = {}
          validationType.fields = fields
          inputFieldKeyList.forEach(key => {
            const subInputField = inputFieldMap[key]
            const subValidationType = getValidationType(subInputField.type)
            const nonNullOptional = subInputField.extensions?.nexus?.config?.nonNullOptional

            fields[key] = {
              type: subValidationType,
              config: { nonNullOptional },
            }
          })
        }
      }
      return validationType
    },
  )

  const createArgsValidationType = (argMap?: GraphQLFieldConfigArgumentMap): ValidationType | undefined => {
    if (argMap) {
      const fields: { [key: string]: ValidationField } = {}
      Object.keys(argMap).forEach(key => {
        const { type } = argMap[key]
        const subValidationType = getValidationType(type)
        if (subValidationType.fields) {
          fields[key] = {
            type: subValidationType,
          }
        }
      })
      if (Object.keys(fields).length) {
        return {
          fields,
        }
      }
    }
  }
  const containsNonNullOptional = (field: NexusInputFieldDef): field is NexusInputFieldDef & { nonNullOptional: true } => (
    'nonNullOptional' in field
  )

  return plugin({
    name: 'non-null-optional-field',
    description: 'Add option to enforce non null values on optional fields',
    fieldDefTypes: DeclarativeNonNullOptional,
    onAddInputField (field) {
      if (containsNonNullOptional(field)) {
        return {
          ...field,
          extensions: {
            ...field.extensions,
            nexus: {
              ...field.extensions?.nexus,
              config: {
                ...field.extensions?.nexus?.config,
                nonNullOptional: field.nonNullOptional,
              },
            },
          },
        }
      }
      return field
    },

    onCreateFieldResolver: (config) => {
      const argsValidationType = createArgsValidationType(config.fieldConfig?.args)
      if (argsValidationType) {
        return (root, args, ctx, info, next) => {
          const errorMap = {}
          validate(args, argsValidationType, ['args'], errorMap)
          if (Object.keys(errorMap).length) {
            throw new Error('following arguments violated nonNullOptional constrain: ' + JSON.stringify(errorMap))
          }
          return next(root, args, ctx, info)
        }
      }
    },
  })
}
