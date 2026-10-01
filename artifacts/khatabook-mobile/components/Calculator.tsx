import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { evaluateCalculatorExpression, formatExpression, formatMoney, trimNumberForExpression } from '@/lib/domain';

type Key = { label: string; value: string; tone?: 'muted' | 'operator' | 'accent' };

const KEYS: Key[][] = [
  [{ label: 'C', value: 'C', tone: 'muted' }, { label: 'M+', value: 'M+', tone: 'muted' }, { label: 'M−', value: 'M-', tone: 'muted' }, { label: '⌫', value: 'DEL', tone: 'muted' }],
  [{ label: '7', value: '7' }, { label: '8', value: '8' }, { label: '9', value: '9' }, { label: '÷', value: '/', tone: 'operator' }],
  [{ label: '4', value: '4' }, { label: '5', value: '5' }, { label: '6', value: '6' }, { label: '×', value: '*', tone: 'operator' }],
  [{ label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' }, { label: '−', value: '-', tone: 'operator' }],
  [{ label: '0', value: '0' }, { label: '.', value: '.' }, { label: '%', value: '%' }, { label: '+', value: '+', tone: 'operator' }],
];

export function Calculator({
  initialAmount = 0,
  onAmountChange,
  disabled = false,
}: {
  initialAmount?: number;
  onAmountChange: (amount: number | null) => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  const [expression, setExpression] = useState(initialAmount > 0 ? trimNumberForExpression(initialAmount) : '');
  const [memoryValue, setMemoryValue] = useState(0);
  const [memoryHistory, setMemoryHistory] = useState<string[]>([]);
  const [justRecalled, setJustRecalled] = useState(false);
  const result = evaluateCalculatorExpression(expression);
  const displayAmount = memoryHistory.length ? memoryValue : result ?? 0;

  const updateExpression = (next: string) => {
    setExpression(next);
    setJustRecalled(false);
    onAmountChange(memoryHistory.length ? memoryValue : evaluateCalculatorExpression(next));
  };

  const handleKey = (key: Key) => {
    if (disabled) return;
    if (key.value === 'C') {
      updateExpression('');
      return;
    }
    if (key.value === 'DEL') {
      updateExpression(expression.slice(0, -1));
      return;
    }
    if (key.value === 'M+' || key.value === 'M-') {
      const safeValue = result !== null && Number.isFinite(result) ? result : 0;
      const nextMemory = key.value === 'M+' ? memoryValue + safeValue : memoryValue - safeValue;
      setMemoryValue(nextMemory);
      setMemoryHistory((previous) => [...previous, `${key.value}(${formatExpression(expression || '0')})=${nextMemory.toFixed(1)}`]);
      setExpression('');
      setJustRecalled(false);
      onAmountChange(nextMemory);
      return;
    }
    if (key.value === '=') {
      if (result !== null) updateExpression(trimNumberForExpression(result));
      return;
    }
    const isOperator = ['+', '-', '*', '/'].includes(key.value);
    if (isOperator && !expression) return;
    const next = isOperator && /[+\-*/]$/.test(expression)
      ? `${expression.slice(0, -1)}${key.value}`
      : `${expression}${key.value}`;
    updateExpression(next);
  };

  const handleMemoryRecall = () => {
    if (justRecalled) {
      setMemoryValue(0);
      setMemoryHistory([]);
      setJustRecalled(false);
      onAmountChange(evaluateCalculatorExpression(expression));
      return;
    }
    const recalled = trimNumberForExpression(memoryValue);
    setExpression(recalled);
    setJustRecalled(true);
    onAmountChange(memoryValue);
  };

  const formula = expression ? formatExpression(expression) : '0';
  const currentResult = memoryHistory.length ? memoryValue : result;

  return (
    <View style={[styles.container, { backgroundColor: colors.secondary }]}>
      <View style={styles.display}>
        <Text style={[styles.formula, { color: colors.mutedForeground }]} numberOfLines={1}>{formula}</Text>
        <TextInput
          value={expression}
          onChangeText={updateExpression}
          keyboardType="numbers-and-punctuation"
          editable={!disabled}
          selectTextOnFocus
          accessibilityLabel="হিসাবের অঙ্ক"
          testID="calculator-expression"
          style={[styles.expressionInput, { color: colors.foreground }]}
          placeholder="0"
          placeholderTextColor={colors.mutedForeground}
        />
        <Text style={[styles.amount, { color: currentResult === null ? colors.destructive : colors.primary }]}>{formatMoney(displayAmount)}</Text>
      </View>
      {memoryHistory.length > 0 ? (
        <View style={[styles.history, { borderTopColor: colors.border }]}>
          {memoryHistory.slice(-4).map((line, index) => <Text key={`${index}-${line}`} style={[styles.historyLine, { color: colors.mutedForeground }]} numberOfLines={1}>{line}</Text>)}
          <Pressable onPress={handleMemoryRecall} disabled={disabled} accessibilityRole="button" testID="calculator-memory-recall" style={[styles.mrcButton, { backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 }]}>
            <Text style={[styles.mrcText, { color: colors.primaryForeground }]}>MRC = {formatMoney(memoryValue)}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.keypad}>
        {KEYS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keyRow}>
            {row.map((key) => {
              const isAccent = key.tone === 'operator';
              const backgroundColor = key.tone === 'muted' ? colors.card : isAccent ? colors.accent : colors.background;
              const textColor = key.tone === 'operator' ? colors.accentForeground : colors.foreground;
              return (
                <Pressable
                  key={key.value}
                  onPress={() => handleKey(key)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={key.label}
                  testID={`calculator-key-${key.value.replace('-', 'minus')}`}
                  style={({ pressed }) => [
                    styles.key,
                    { backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.keyLabel, { color: textColor }]}>{key.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
        <Pressable onPress={() => handleKey({ label: '=', value: '=' })} disabled={disabled} accessibilityRole="button" testID="calculator-key-equals" style={[styles.equals, { backgroundColor: colors.primary, opacity: disabled ? 0.45 : 1 }]}>
          <Text style={[styles.equalsText, { color: colors.primaryForeground }]}>=</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 18, padding: 12, gap: 10 },
  display: { minHeight: 118, justifyContent: 'flex-end', alignItems: 'flex-end', padding: 8, gap: 3 },
  formula: { width: '100%', textAlign: 'right', fontSize: 13 },
  expressionInput: { width: '100%', minHeight: 42, textAlign: 'right', padding: 0, fontSize: 26, fontWeight: '700' },
  amount: { fontSize: 18, fontWeight: '800' },
  history: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 4 },
  historyLine: { fontSize: 12, fontVariant: ['tabular-nums'] },
  mrcButton: { minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  mrcText: { fontSize: 14, fontWeight: '800' },
  keypad: { gap: 7 },
  keyRow: { flexDirection: 'row', gap: 7 },
  key: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 18, fontWeight: '700' },
  equals: { minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  equalsText: { fontSize: 20, fontWeight: '800' },
});