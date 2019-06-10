import { visit, GraphQLError } from 'graphql';
import { ServiceDefinition } from '../../types';

// import { logServiceAndType, errorWithCode } from '../../utils';

/**
 * - There are no fields with @external on base type definitions
 */
export const duplicateEnumOrScalar = ({
  // name: serviceName,
  typeDefs,
}: ServiceDefinition) => {
  const errors: GraphQLError[] = [];

  visit(typeDefs, {
    EnumTypeDefinition(enumDefinition) {
      // todo
    },
  });

  return errors;
};
