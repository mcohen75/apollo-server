const checkEnumsForMatches = (
  definitionsMap: DefinitionsMap,
): GraphQLError[] => {
  const errors: GraphQLError[] = [];

  function isEnumDefinition(entry: DefinitionsMapEntry) {
    return entry.definition.kind === Kind.ENUM_TYPE_DEFINITION;
  }

  for (const [name, definitions] of Object.entries(definitionsMap)) {
    // if every definition in the list is an enum, we don't need to error about type
    if (definitions.every(isEnumDefinition)) {
      let simpleEnumDefs: Array<{ serviceName: string; values: string[] }> = [];
      definitions.map(({ definition, serviceName }) => {
        const enumValues = (definition as EnumTypeDefinitionNode).values;
        if (serviceName && enumValues)
          simpleEnumDefs.push({
            serviceName,
            values: enumValues.map(
              (enumValue: EnumValueDefinitionNode) => enumValue.name.value,
            ),
          });
      });
      simpleEnumDefs.map(enumDef => {
        enumDef.values = enumDef.values.sort();
      });

      // like {"FURNITURE,BOOK": ["ServiceA", "ServiceB"]}
      let matchingEnumGroups: { [values: string]: string[] } = {};
      simpleEnumDefs.map(def => {
        const key = def.values.join();
        if (matchingEnumGroups[key]) {
          matchingEnumGroups[key].push(def.serviceName);
        } else {
          matchingEnumGroups[key] = [def.serviceName];
        }
      });
      if (Object.keys(matchingEnumGroups).length > 1) {
        errors.push(
          errorWithCode(
            'ENUM_MISMATCH',
            `Enums do not have the same values across services. Groups of services with matching enum values are: ${Object.values(
              matchingEnumGroups,
            )
              .map(serviceNames => `[${serviceNames.join(', ')}]`)
              .join(', ')}`,
          ),
        );
      }
    } else if (definitions.some(isEnumDefinition)) {
      // if only some definitions in the list are enums, we need to error
      // first, find the services, where the defs ARE enums
      const servicesWithEnum = definitions
        .filter(isEnumDefinition)
        .map(definition => definition.serviceName)
        .filter(isString);

      // find the services where the def isn't an enum
      const servicesWithoutEnums = definitions
        .filter(d => !isEnumDefinition(d))
        .map(d => d.serviceName);

      errors.push(
        errorWithCode(
          'ENUM_MISMATCH_TYPE',
          logServiceAndType(servicesWithEnum[0], name) +
            `${name} is an enum in [${servicesWithEnum.join(
              ', ',
            )}], but not in [${servicesWithoutEnums.join(', ')}]`,
        ),
      );
    }
  }
  return errors;
};
