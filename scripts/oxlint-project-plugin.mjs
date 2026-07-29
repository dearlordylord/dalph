const report = (context, node, message) => {
  context.report({ node, message })
}

const memberName = (node) => {
  if (node.computed && node.property.type === "Literal") return node.property.value
  if (node.property.type === "Identifier") return node.property.name
  return undefined
}

const isIdentifier = (node, name) => node?.type === "Identifier" && node.name === name

const effectClassInheritanceOnly = {
  create: (context) => {
    const isAllowedEffectFactory = (superClass) => {
      if (superClass?.type !== "CallExpression") return false
      const factoryCall = superClass.callee
      if (factoryCall?.type !== "CallExpression") return false
      const factory = factoryCall.callee
      if (factory?.type !== "MemberExpression" || factory.computed) return false
      if (factory.object.type !== "Identifier" || factory.property.type !== "Identifier") return false
      return (
        (factory.object.name === "Context" && factory.property.name === "Service")
        || (factory.object.name === "Schema" && factory.property.name === "TaggedErrorClass")
      )
    }

    const checkInheritance = (node) => {
      if (node.superClass !== null && !isAllowedEffectFactory(node.superClass)) {
        report(context, node, "Class inheritance is restricted to Context.Service and Schema.TaggedErrorClass.")
      }
    }

    return {
      ClassDeclaration: checkInheritance,
      ClassExpression: checkInheritance
    }
  }
}

const noAmbientCapabilityBypass = {
  create: (context) => ({
    CallExpression: (node) => {
      if (isIdentifier(node.callee, "require")) {
        report(context, node, "Use injected Effect services instead of loading ambient host capabilities with require().")
      }
      if (
        node.callee.type === "MemberExpression"
        && isIdentifier(node.callee.object, "Math")
        && memberName(node.callee) === "random"
      ) {
        report(context, node, "Inject randomness through Effect Random instead of calling Math.random().")
      }
    }
  })
}

const noClockRead = {
  create: (context) => ({
    NewExpression: (node) => {
      if (isIdentifier(node.callee, "Date") && node.arguments.length === 0) {
        report(context, node, "Inject time through Effect Clock or a service instead of constructing the current Date.")
      }
    },
    CallExpression: (node) => {
      if (
        node.callee.type === "MemberExpression"
        && isIdentifier(node.callee.object, "Date")
        && memberName(node.callee) === "now"
      ) {
        report(context, node, "Inject time through Effect Clock or a service instead of calling Date.now().")
      }
    }
  })
}

const forbiddenMockMembers = new Set(["doMock", "mock", "spyOn", "stubGlobal", "unmock"])

const noModuleMocks = {
  create: (context) => ({
    ImportDeclaration: (node) => {
      if (node.source.value !== "vitest" && node.source.value !== "@effect/vitest") return
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          report(context, specifier, `Do not namespace-import ${node.source.value}; it bypasses the module-mock guard.`)
        }
        if (
          specifier.type === "ImportSpecifier"
          && isIdentifier(specifier.imported, "vi")
        ) {
          report(context, specifier, "Do not import vi. Substitute behavior through Effect services and Layers.")
        }
      }
    },
    CallExpression: (node) => {
      if (node.callee.type !== "MemberExpression") return
      const name = memberName(node.callee)
      if (
        (isIdentifier(node.callee.object, "vi") && forbiddenMockMembers.has(name))
        || (isIdentifier(node.callee.object, "jest") && name === "mock")
      ) {
        report(context, node, "Module mocks are forbidden. Substitute behavior through Effect services and Layers.")
      }
    },
    VariableDeclarator: (node) => {
      if (!isIdentifier(node.init, "vi") || node.id.type !== "ObjectPattern") return
      for (const property of node.id.properties) {
        if (property.type === "Property" && forbiddenMockMembers.has(memberName({ ...property, property: property.key }))) {
          report(context, property, "Do not destructure module-mocking APIs from vi.")
        }
      }
    }
  })
}

const noDoubleTypeAssertion = {
  create: (context) => ({
    TSAsExpression: (node) => {
      if (node.expression.type === "TSAsExpression") {
        report(context, node, "Double assertions erase evidence even in tests.")
      }
    },
    TSTypeAssertion: (node) => {
      if (node.expression.type === "TSTypeAssertion") {
        report(context, node, "Double assertions erase evidence even in tests.")
      }
    }
  })
}

const noThrowStatement = {
  create: (context) => ({
    ThrowStatement: (node) => {
      report(context, node, "Expected failures must use precise typed Effect failures; throwing is forbidden here.")
    }
  })
}

const noTypeAssertion = {
  create: (context) => ({
    TSAsExpression: (node) => {
      const annotation = node.typeAnnotation
      const isConst = annotation.type === "TSTypeReference" && isIdentifier(annotation.typeName, "const")
      if (!isConst) {
        report(context, node, "Unchecked type assertions are forbidden. Parse with Schema, use satisfies, or restructure.")
      }
    },
    TSTypeAssertion: (node) => {
      report(context, node, "Unchecked type assertions are forbidden. Parse with Schema, use satisfies, or restructure.")
    }
  })
}

const propertyTestPlacement = {
  create: (context) => ({
    ImportDeclaration: (node) => {
      if (node.source.value === "fast-check") {
        report(context, node, "Property-based tests must live in *.property.test.ts files.")
      }
    },
    CallExpression: (node) => {
      if (
        node.callee.type === "MemberExpression"
        && isIdentifier(node.callee.object, "fc")
        && memberName(node.callee) === "property"
      ) {
        report(context, node, "Move fc.property tests to a *.property.test.ts file.")
      }
    }
  })
}

const requireCanonicalEffectImport = {
  create: (context) => ({
    ImportDeclaration: (node) => {
      if (node.source.value !== "effect") return
      for (const specifier of node.specifiers) {
        if (specifier.type === "ImportNamespaceSpecifier") {
          report(context, specifier, "Import Effect modules by name; namespace imports hide enforceable boundaries.")
        }
        if (
          specifier.type === "ImportSpecifier"
          && isIdentifier(specifier.imported, "Schema")
          && !isIdentifier(specifier.local, "Schema")
        ) {
          report(context, specifier, "Keep the canonical Schema name so boundary rules remain visible.")
        }
      }
    }
  })
}

const naturalKeyCollator = new Intl.Collator("en", { numeric: true })

const patternKey = (node) => {
  if (node.type === "RestElement") return { name: node.argument.name, order: 99 }
  if (node.type !== "Property" || node.computed) return undefined
  if (node.key.type === "Identifier") return { name: node.key.name, order: 1 }
  if (node.key.type === "Literal") return { name: String(node.key.value), order: 1 }
  return undefined
}

const containsIdentifier = (node, names) => {
  if (node === null || typeof node !== "object") return false
  if (node.type === "Identifier" && names.has(node.name)) return true
  return Object.entries(node).some(([key, value]) => {
    if (key === "parent" || key === "range" || key === "loc") return false
    if (Array.isArray(value)) return value.some((entry) => containsIdentifier(entry, names))
    return containsIdentifier(value, names)
  })
}

const sortablePattern = (node) => {
  const keys = node.properties.map(patternKey)
  if (keys.some((key) => key === undefined)) return undefined
  const boundNames = new Set(keys.map((key) => key.name))
  const orderSensitive = node.properties.some((property) =>
    property.type === "Property"
    && property.value.type === "AssignmentPattern"
    && containsIdentifier(property.value.right, boundNames)
  )
  return orderSensitive ? undefined : keys
}

const sortDestructureKeys = {
  meta: {
    fixable: "code"
  },
  create: (context) => ({
    ObjectPattern: (node) => {
      const keys = sortablePattern(node)
      if (keys === undefined) return
      const indexed = node.properties.map((property, index) => ({ property, key: keys[index] }))
      const sorted = indexed.toSorted((left, right) =>
        left.key.order - right.key.order || naturalKeyCollator.compare(left.key.name, right.key.name)
      )
      const mismatch = indexed.findIndex((entry, index) => entry.property !== sorted[index].property)
      if (mismatch === -1) return

      context.report({
        node: indexed[mismatch].property,
        message: `Expected object destructuring keys to be sorted; ${sorted[mismatch].key.name} belongs before ${indexed[mismatch].key.name}.`,
        fix: (fixer) => {
          const source = context.sourceCode.text
          const separators = node.properties.slice(0, -1).map((property, index) =>
            source.slice(property.range[1], node.properties[index + 1].range[0])
          )
          const text = sorted.map(({ property }, index) =>
            context.sourceCode.getText(property) + (separators[index] ?? "")
          ).join("")
          return fixer.replaceTextRange(
            [node.properties[0].range[0], node.properties.at(-1).range[1]],
            text
          )
        }
      })
    }
  })
}

export default {
  meta: {
    name: "dalph"
  },
  rules: {
    "effect-class-inheritance-only": effectClassInheritanceOnly,
    "no-ambient-capability-bypass": noAmbientCapabilityBypass,
    "no-clock-read": noClockRead,
    "no-double-type-assertion": noDoubleTypeAssertion,
    "no-module-mocks": noModuleMocks,
    "no-throw-statement": noThrowStatement,
    "no-type-assertion": noTypeAssertion,
    "property-test-placement": propertyTestPlacement,
    "require-canonical-effect-import": requireCanonicalEffectImport,
    "sort-destructure-keys": sortDestructureKeys
  }
}
