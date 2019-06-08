import gql from 'graphql-tag';
import {
  Kind,
  graphql,
  DocumentNode,
  GraphQLAbstractType,
  GraphQLObjectType,
} from 'graphql';
import { makeExecutableSchema } from 'apollo-server';
import { buildFederatedSchema } from '../buildFederatedSchema';
import { typeSerializer } from '../../snapshotSerializers';

expect.addSnapshotSerializer(typeSerializer);

const EMPTY_DOCUMENT = {
  kind: Kind.DOCUMENT,
  definitions: [],
};

describe('buildFederatedSchema', () => {
  it(`should mark a type with a key field as an entity`, () => {
    const schema = buildFederatedSchema(gql`
      type Product @key(fields: "upc") {
        upc: String!
        name: String
        price: Int
      }
    `);

    expect(schema.getType('Product')).toMatchInlineSnapshot(`
type Product {
  upc: String!
  name: String
  price: Int
}
`);

    expect(schema.getType('_Entity')).toMatchInlineSnapshot(
      `union _Entity = Product`,
    );
  });

  it(`should mark a type with multiple key fields as an entity`, () => {
    const schema = buildFederatedSchema(gql`
      type Product @key(fields: "upc") @key(fields: "sku") {
        upc: String!
        sku: String!
        name: String
        price: Int
      }
    `);

    expect(schema.getType('Product')).toMatchInlineSnapshot(`
type Product {
  upc: String!
  sku: String!
  name: String
  price: Int
}
`);

    expect(schema.getType('_Entity')).toMatchInlineSnapshot(
      `union _Entity = Product`,
    );
  });

  it(`should not mark a type without a key field as an entity`, () => {
    const schema = buildFederatedSchema(gql`
      type Money {
        amount: Int!
        currencyCode: String!
      }
    `);

    expect(schema.getType('Money')).toMatchInlineSnapshot(`
type Money {
  amount: Int!
  currencyCode: String!
}
`);
  });

  describe(`should add an _entities query root field to the schema`, () => {
    it(`when a query root type with the default name has been defined`, () => {
      const schema = buildFederatedSchema(gql`
        type Query {
          rootField: String
        }
        type Product @key(fields: "upc") {
          upc: ID!
        }
      `);

      expect(schema.getQueryType()).toMatchInlineSnapshot(`
type Query {
  _entities(representations: [_Any!]!): [_Entity]!
  _service: _Service!
  rootField: String
}
`);
    });

    it(`when a query root type with a non-default name has been defined`, () => {
      const schema = buildFederatedSchema(gql`
        schema {
          query: QueryRoot
        }

        type QueryRoot {
          rootField: String
        }
        type Product @key(fields: "upc") {
          upc: ID!
        }
      `);

      expect(schema.getQueryType()).toMatchInlineSnapshot(`
type QueryRoot {
  _entities(representations: [_Any!]!): [_Entity]!
  _service: _Service!
  rootField: String
}
`);
    });
  });
  describe(`should not add an _entities query root field to the schema`, () => {
    it(`when no query root type has been defined`, () => {
      const schema = buildFederatedSchema(EMPTY_DOCUMENT);

      expect(schema.getQueryType()).toMatchInlineSnapshot(`
type Query {
  _service: _Service!
}
`);
    });
    it(`when no types with keys are found`, () => {
      const schema = buildFederatedSchema(gql`
        type Query {
          rootField: String
        }
      `);

      expect(schema.getQueryType()).toMatchInlineSnapshot(`
type Query {
  _service: _Service!
  rootField: String
}
`);
    });
    it(`when only an interface with keys are found`, () => {
      const schema = buildFederatedSchema(gql`
        type Query {
          rootField: String
        }
        interface Product @key(fields: "upc") {
          upc: ID!
        }
      `);

      expect(schema.getQueryType()).toMatchInlineSnapshot(`
type Query {
  _service: _Service!
  rootField: String
}
`);
    });
  });
  describe('_entities root field', () => {
    it('executes resolveReference for a type if found', async () => {
      const query = `query GetEntities($representations: [_Any!]!) {
      _entities(representations: $representations) {
        ... on Product {
          name
        }
        ... on User {
          firstName
        }
      }
    }`;

      const variables = {
        representations: [
          { __typename: 'Product', upc: 1 },
          { __typename: 'User', id: 1 },
        ],
      };

      const schema = buildFederatedSchema([
        {
          typeDefs: gql`
            type Product @key(fields: "upc") {
              upc: Int
              name: String
            }
            type User @key(fields: "id") {
              firstName: String
            }
          `,
          resolvers: {
            Product: {
              __resolveReference(object) {
                expect(object.upc).toEqual(1);
                return { name: 'Apollo Gateway' };
              },
            },
            User: {
              __resolveReference(object) {
                expect(object.id).toEqual(1);
                return Promise.resolve({ firstName: 'James' });
              },
            },
          },
        },
      ]);
      const { data, errors } = await graphql(
        schema,
        query,
        null,
        null,
        variables,
      );
      expect(errors).toBeUndefined();
      expect(data._entities[0].name).toEqual('Apollo Gateway');
      expect(data._entities[1].firstName).toEqual('James');
    });
    it('executes resolveReference with default representation values', async () => {
      const query = `query GetEntities($representations: [_Any!]!) {
      _entities(representations: $representations) {
        ... on Product {
          upc
          name
        }
      }
    }`;

      const variables = {
        representations: [
          { __typename: 'Product', upc: 1, name: 'Apollo Gateway' },
        ],
      };

      const schema = buildFederatedSchema(gql`
        type Product @key(fields: "upc") {
          upc: Int
          name: String
        }
      `);
      const { data, errors } = await graphql(
        schema,
        query,
        null,
        null,
        variables,
      );
      expect(errors).toBeUndefined();
      expect(data._entities[0].name).toEqual('Apollo Gateway');
    });
  });
  describe('_service root field', () => {
    it('keeps extension types when owner type is not present', async () => {
      const query = `query GetServiceDetails {
      _service {
        sdl
      }
    }`;
      const schema = buildFederatedSchema(gql`
        type Review {
          id: ID
        }

        extend type Review {
          title: String
        }

        extend type Product @key(fields: "upc") {
          upc: String @external
          reviews: [Review]
        }
      `);

      const { data, errors } = await graphql(schema, query);
      expect(errors).toBeUndefined();
      expect(data._service.sdl)
        .toEqual(`extend type Product @key(fields: "upc") {
  upc: String @external
  reviews: [Review]
}

type Review {
  id: ID
  title: String
}
`);
    });
    it('keeps extension interface when owner interface is not present', async () => {
      const query = `query GetServiceDetails {
    _service {
      sdl
    }
  }`;
      const schema = buildFederatedSchema(gql`
        type Review {
          id: ID
        }

        extend type Review {
          title: String
        }

        interface Node @key(fields: "id") {
          id: ID!
        }

        extend interface Product @key(fields: "upc") {
          upc: String @external
          reviews: [Review]
        }
      `);

      const { data, errors } = await graphql(schema, query);
      expect(errors).toBeUndefined();
      expect(data._service.sdl).toEqual(`interface Node @key(fields: "id") {
  id: ID!
}

extend interface Product @key(fields: "upc") {
  upc: String @external
  reviews: [Review]
}

type Review {
  id: ID
  title: String
}
`);
    });
    it('returns valid sdl for @key directives', async () => {
      const query = `query GetServiceDetails {
      _service {
        sdl
      }
    }`;
      const schema = buildFederatedSchema(gql`
        type Product @key(fields: "upc") {
          upc: String!
          name: String
          price: Int
        }
      `);

      const { data, errors } = await graphql(schema, query);
      expect(errors).toBeUndefined();
      expect(data._service.sdl).toEqual(`type Product @key(fields: "upc") {
  upc: String!
  name: String
  price: Int
}
`);
    });
    it('returns valid sdl for multiple @key directives', async () => {
      const query = `query GetServiceDetails {
      _service {
        sdl
      }
    }`;
      const schema = buildFederatedSchema(gql`
        type Product @key(fields: "upc") @key(fields: "name") {
          upc: String!
          name: String
          price: Int
        }
      `);

      const { data, errors } = await graphql(schema, query);
      expect(errors).toBeUndefined();
      expect(data._service.sdl)
        .toEqual(`type Product @key(fields: "upc") @key(fields: "name") {
  upc: String!
  name: String
  price: Int
}
`);
    });
    it('supports all federation directives', async () => {
      const query = `query GetServiceDetails {
        _service {
          sdl
        }
      }`;

      const schema = buildFederatedSchema(gql`
        type Review @key(fields: "id") {
          id: ID!
          body: String
          author: User @provides(fields: "email")
          product: Product @provides(fields: "upc")
        }

        extend type User @key(fields: "email") {
          email: String @external
          reviews: [Review]
        }

        extend type Product @key(fields: "upc") {
          upc: String @external
          reviews: [Review]
        }
      `);

      const { data, errors } = await graphql(schema, query);
      expect(errors).toBeUndefined();
      expect(data._service.sdl)
        .toEqual(`extend type Product @key(fields: "upc") {
  upc: String @external
  reviews: [Review]
}

type Review @key(fields: "id") {
  id: ID!
  body: String
  author: User @provides(fields: "email")
  product: Product @provides(fields: "upc")
}

extend type User @key(fields: "email") {
  email: String @external
  reviews: [Review]
}
`);
    });
  });

  fdescribe('the isTypeOf bug', () => {
    it('demonstrates the bug', () => {
      const animals = [{ id: 1, name: 'Doggy' }];

      const typeDefs: DocumentNode = gql`
        union Animal = Dog

        type Dog {
          id: ID!
          name: String!
        }

        type Query {
          animals: [Animal]
        }
      `;

      const resolvers = {
        Animal: {
          __resolveType: obj => {
            return 'Dog';
          },
        },
        Dog: {
          __isTypeOf: animal => {
            return true;
          },
        },
        Query: { animals: () => animals },
      };

      // Build a federated version of the schema, grab interface and concrete types for comparison
      const federated = buildFederatedSchema([{ typeDefs, resolvers }]);
      const federatedAnimal = federated.getType(
        'Animal',
      ) as GraphQLAbstractType;
      const federatedDog = federated.getType('Dog') as GraphQLObjectType;

      // Build a standard version of the schema, grab interface and concrete types for compare
      const standard = makeExecutableSchema({
        typeDefs,
        resolvers,
      });
      const standardAnimal = standard.getType('Animal') as GraphQLAbstractType;
      const standardDog = standard.getType('Dog') as GraphQLObjectType;

      expect(federatedAnimal.resolveType).toBeDefined();
      expect(federatedDog.isTypeOf).toBeDefined();
      expect(standardAnimal.resolveType).toBeDefined();
      expect(standardDog.isTypeOf).toBeDefined();
    });
  });
});
