import gql from 'graphql-tag';
import { duplicateEnumOrScalar as validateDuplicateEnumOrScalar } from '../';
import { graphqlErrorSerializer } from '../../../../snapshotSerializers';

expect.addSnapshotSerializer(graphqlErrorSerializer);

describe('duplicateEnumOrScalar', () => {
  it('', () => {
    const serviceA = {
      typeDefs: gql`
        type Product @key(fields: "color { id value }") {
          sku: String!
          upc: String!
          color: Color!
        }

        type Color {
          id: ID!
          value: String!
        }

        enum ProductType {
          BOOK
          FURNITURE
        }

        enum ProductType {
          DIGITAL
        }
      `,
      name: 'serviceA',
    };

    const warnings = validateDuplicateEnumOrScalar(serviceA);
    expect(warnings).toEqual([]);
  });
});
