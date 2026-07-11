'use strict';

/**
 * Flags `+ - * /` used directly on identifiers/properties that look like
 * monetary values (amount, montant, debit, credit, solde, balance, price,
 * prix, total, ht, ttc, tva, ...). Money must go through the Decimal API
 * (Money / Prisma.Decimal), never native JS number arithmetic. See the
 * "Money handling" section in CLAUDE.md.
 */

const MONEY_PATTERN =
  /(amount|montant|debit|credit|solde|balance|price|prix|total|^ht$|ttc|tva|_ht$|_ttc$)/i;

/** @param {import('estree').Expression} node */
function looksLikeMoney(node) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    return MONEY_PATTERN.test(node.name);
  }
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    return MONEY_PATTERN.test(node.property.name);
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow native number arithmetic on values that look like money; use the Decimal API instead',
    },
    schema: [],
    messages: {
      noFloatMoney:
        'Monetary values must use the Decimal API (Money / Prisma.Decimal), not native "{{operator}}" arithmetic. See CLAUDE.md "Money handling".',
    },
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!['+', '-', '*', '/'].includes(node.operator)) return;
        if (looksLikeMoney(node.left) || looksLikeMoney(node.right)) {
          context.report({ node, messageId: 'noFloatMoney', data: { operator: node.operator } });
        }
      },
      AssignmentExpression(node) {
        if (!['+=', '-=', '*=', '/='].includes(node.operator)) return;
        if (looksLikeMoney(node.left)) {
          context.report({ node, messageId: 'noFloatMoney', data: { operator: node.operator } });
        }
      },
    };
  },
};
