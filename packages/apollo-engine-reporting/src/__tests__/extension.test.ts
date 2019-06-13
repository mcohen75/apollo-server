import { makeExecutableSchema, addMockFunctionsToSchema } from 'graphql-tools';
import {
  GraphQLExtensionStack,
  enableGraphQLExtensions,
} from 'graphql-extensions';
import { Trace } from 'apollo-engine-reporting-protobuf';
import { graphql } from 'graphql';
import { Request } from 'node-fetch';
import { EngineReportingExtension, makeTraceDetails } from '../extension';
import { InMemoryLRUCache } from 'apollo-server-caching';

test('trace construction', async () => {
  const typeDefs = `
  type User {
    id: Int
    name: String
    posts(limit: Int): [Post]
  }

  type Post {
    id: Int
    title: String
    views: Int
    author: User
  }

  type Query {
    aString: String
    aBoolean: Boolean
    anInt: Int
    author(id: Int): User
    topPosts(limit: Int): [Post]
  }
`;

  const query = `
    query q {
      author(id: 5) {
        name
        posts(limit: 2) {
          id
        }
      }
      aBoolean
    }
`;

  const schema = makeExecutableSchema({ typeDefs });
  addMockFunctionsToSchema({ schema });
  enableGraphQLExtensions(schema);

  const traces: Array<any> = [];
  function addTrace(
    signature: Promise<string | null>,
    operationName: string,
    trace: Trace,
  ) {
    traces.push({ signature, operationName, trace });
  }

  const reportingExtension = new EngineReportingExtension({}, addTrace);
  const stack = new GraphQLExtensionStack([reportingExtension]);
  const requestDidEnd = stack.requestDidStart({
    request: new Request('http://localhost:123/foo') as any,
    queryString: query,
    requestContext: {
      request: {
        query,
        operationName: 'q',
        extensions: {
          clientName: 'testing suite',
        },
      },
      context: {},
      cache: new InMemoryLRUCache(),
    },
  });
  await graphql({
    schema,
    source: query,
    contextValue: { _extensionStack: stack },
  });
  requestDidEnd();
  // XXX actually write some tests
});

const variables: Record<string, any> = {
  testing: 'testing',
  t2: 2,
};

test('check variableJson output for privacyEnforcer boolean type', () => {
  // Case 1: No keys/values in variables to be filtered/not filtered
  const emptyOutput = new Trace.Details();
  emptyOutput.privacyEnforcerType =
    Trace.Details.PrivateVariableEnforcerType.BOOLEAN;
  expect(makeTraceDetails({}, true)).toEqual(emptyOutput);
  expect(makeTraceDetails({}, false)).toEqual(emptyOutput);

  // Case 2: Filter all variables (enforce == True)
  const filteredOutput = new Trace.Details();
  filteredOutput.privacyEnforcerType =
    Trace.Details.PrivateVariableEnforcerType.BOOLEAN;
  Object.keys(variables).forEach(name => {
    filteredOutput.variablesJson[name] = '';
  });
  expect(makeTraceDetails(variables, true)).toEqual(filteredOutput);

  // Case 3: Do not filter variables (enforce == False)
  const nonFilteredOutput = new Trace.Details();
  nonFilteredOutput.privacyEnforcerType =
    Trace.Details.PrivateVariableEnforcerType.BOOLEAN;
  Object.keys(variables).forEach(name => {
    nonFilteredOutput.variablesJson[name] = JSON.stringify(variables[name]);
  });
  expect(makeTraceDetails(variables, false)).toEqual(nonFilteredOutput);
});

test('variableJson output for privacyEnforcer Array type', () => {
  const privacyEnforcerArray: string[] = ['testing', 'notInVariables'];
  const expectedVariablesJson = {
    testing: '',
    t2: JSON.stringify(2),
  };
  expect(
    makeTraceDetails(variables, privacyEnforcerArray).variablesJson,
  ).toEqual(expectedVariablesJson);
  expect(
    makeTraceDetails(variables, privacyEnforcerArray).privacyEnforcerType,
  ).toEqual(Trace.Details.PrivateVariableEnforcerType.ARRAY);
});

test('variableJson output for privacyEnforcer custom function', () => {
  // Custom function that redacts every variable to 100;
  const modifiedValue = 100;
  const customEnforcer = (input: Record<string, any>): Record<string, any> => {
    let out: Record<string, any> = {};
    Object.keys(input).map((name: string) => {
      out[name] = modifiedValue;
    });
    return out;
  };

  // Expected output
  const output = new Trace.Details();
  output.privacyEnforcerType =
    Trace.Details.PrivateVariableEnforcerType.FUNCTION;
  Object.keys(variables).forEach(name => {
    output.variablesJson[name] = JSON.stringify(modifiedValue);
  });

  expect(makeTraceDetails(variables, customEnforcer)).toEqual(output);
});

test('privacyEnforcer=True equivalent to privacyEnforcer=Array(all variables)', () => {
  let privateVariablesArray: string[] = ['testing', 't2'];
  expect(makeTraceDetails(variables, true).variablesJson).toEqual(
    makeTraceDetails(variables, privateVariablesArray).variablesJson,
  );
});
