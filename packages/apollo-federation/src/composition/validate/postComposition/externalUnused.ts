import {
  GraphQLSchema,
  isObjectType,
  GraphQLError,
  getNamedType,
} from 'graphql';

import {
  findDirectivesOnTypeOrField,
  logServiceAndType,
  hasMatchingFieldInDirectives,
  errorWithCode,
  findTypesContainingFieldWithReturnType,
} from '../../utils';

/**
 *  for every @external field, there should be a @requires, @key, or @provides
 *  directive that uses it
 */
export const externalUnused = (schema: GraphQLSchema) => {
  const errors: GraphQLError[] = [];
  const types = schema.getTypeMap();
  for (const [typeName, namedType] of Object.entries(types)) {
    // Only object types have fields
    if (!isObjectType(namedType)) continue;
    // If externals is populated, we need to look at each one and confirm
    // it is used
    if (namedType.federation && namedType.federation.externals) {
      const keySelections = namedType.federation.keys;

      // loop over every service that has extensions with @external
      for (const [serviceName, externalFieldsForService] of Object.entries(
        namedType.federation.externals,
      )) {
        const keysForService = keySelections[serviceName];
        // for a single service, loop over the external fields.
        for (const { field: externalField } of externalFieldsForService) {
          const externalFieldName = externalField.name.value;
          const allFields = namedType.getFields();

          // check the selected fields of every @key provided by `serviceName`
          const hasMatchingKeyOnType = Boolean(
            keysForService &&
              keysForService
                .flat()
                .find(
                  selectedField =>
                    selectedField.name.value === externalFieldName,
                ),
          );

          /**
           * Provides exists on a _field_ that returns a type which is defined by an extension
           * extend type Kitchen {
           *   name: String @external
           * }
           *
           * type User {
           *   kitchen: Kitchen @provides(fields: "name)
           * }
           *
           * Here, we have the external field. We want to search the schema for
           * the return type of the PARENT of the external field (Kitchen)
           *
           * If we find a field that has the correct return, we should check the provides
           * to see if the current external field is selected
           */
          if (externalField.name.value === 'name') {
            console.log(getNamedType(externalField));
            const hasMatchingProvides = findTypesContainingFieldWithReturnType(
              schema,
              externalField,
            ).map(childType => {
              const fields = childType.getFields();
              Object.values(fields).forEach(maybeProvidesFieldFromChildType => {
                providesDirectives = providesDirectives.concat(
                  findDirectivesOnTypeOrField(
                    maybeProvidesFieldFromChildType.astNode,
                    'provides',
                  ),
                );
              });
            });
          }

          // console.log({ namedType, allFields, hasMatchingProvides });
          const hasMatchingProvidesOrRequires = Object.values(allFields).some(
            maybeProvidesField => {
              const fieldOwner =
                maybeProvidesField.federation &&
                maybeProvidesField.federation.serviceName;

              if (fieldOwner !== serviceName) return false;

              // if the provides is located directly on the type
              // type User { username: String, user: User @provides(fields: "username") }
              let providesDirectives = findDirectivesOnTypeOrField(
                maybeProvidesField.astNode,
                'provides',
              );

              /*
                @provides is most commonly used from another type than where
                the @external directive is applied. We need to find all
                fields on any type in the schema that return this type
                and see if they have a provides directive that uses this
                external field

                type Review {
                  author: User @provides(fields: "username")
                }

                extend type User @key(fields: "id") {
                  id: ID! @external
                  username: String @external
                  reviews: [Review]
                }
              */

              findTypesContainingFieldWithReturnType(
                schema,
                maybeProvidesField,
              ).map(childType => {
                const fields = childType.getFields();
                Object.values(fields).forEach(
                  maybeProvidesFieldFromChildType => {
                    providesDirectives = providesDirectives.concat(
                      findDirectivesOnTypeOrField(
                        maybeProvidesFieldFromChildType.astNode,
                        'provides',
                      ),
                    );
                  },
                );
              });

              const requiresDirectives = findDirectivesOnTypeOrField(
                maybeProvidesField.astNode,
                'requires',
              );

              return (
                hasMatchingFieldInDirectives({
                  directives: providesDirectives,
                  fieldNameToMatch: externalFieldName,
                  namedType,
                }) ||
                hasMatchingFieldInDirectives({
                  directives: requiresDirectives,
                  fieldNameToMatch: externalFieldName,
                  namedType,
                })
              );
            },
          );

          if (!(hasMatchingKeyOnType || hasMatchingProvidesOrRequires)) {
            errors.push(
              errorWithCode(
                'EXTERNAL_UNUSED',
                logServiceAndType(serviceName, typeName, externalFieldName) +
                  `is marked as @external but is not used by a @requires, @key, or @provides directive.`,
              ),
            );
          }
        }
      }
    }
  }

  return errors;
};
