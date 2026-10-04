import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { useColors } from '@/hooks/useColors';
import { evaluateCalculatorExpression, formatExpression, formatMoney, trimNumberForExpression } from '@/lib/domain';

type Key = { label: string; value: string; tone?: 'muted' | 'operator'; span?: number };
type TextSelection = { start: number; end: number };

const KEYS: { columns: number; keys: Key[] }[] = [
  { columns: 4, keys: [{ label: 'C', value: 'C', tone: 'muted' }, { label: 'M+', value: 'M+', tone: 'muted' }, { label: 'M−', value: 'M-', tone: 'muted' }, { label: '⌫', value: 'DEL' }] },
  { columns: 5, keys: [{ label: '7', value: '7' }, { label: '8', value: '8' }, { label: '9', value: '9' }, { label: '÷', value: '/', tone: 'muted' }, { label: '%', value: '%', tone: 'muted' }] },
  { columns: 5, keys: [{ label: '4', value: '4' }, { label: '5', value: '5' }, { label: '6', value: '6' }, { label: '×', value: '*', tone: 'muted', span: 2 }] },
  { columns: 5, keys: [{ label: '1', value: '1' }, { label: '2', value: '2' }, { label: '3', value: '3' }, { label: '−', value: '-', tone: 'operator', span: 2 }] },
  { columns: 5, keys: [{ label: '0', value: '0' }, { label: '.', value: '.' }, { label: '=', value: '=', tone: 'muted' }, { label: '+', value: '+', tone: 'operator', span: 2 }] },
];

export function Calculator({
  initialAmount = 0,
  onAmountChange,
  disabled = false,
  onInteraction,
  currencyColor,
  children,
}: {
  initialAmount?: number;
  onAmountChange: (amount: number | null) => void;
  disabled?: boolean;
  onInteraction?: () => void;
  currencyColor?: string;
  children?: (parts: { display: React.ReactNode; keypad: React.ReactNode }) => React.ReactNode;
}) {
  const colors = useColors();
  const tapAudioPlayer = useAudioPlayer(
    require('../assets/audio/calculator-key-tap.mp3'),
    { downloadFirst: true },
  );
  const [expression, setExpression] = useState(initialAmount > 0 ? trimNumberForExpression(initialAmount) : '');
  const [selection, setSelection] = useState<TextSelection>(() => {
    const caret = initialAmount > 0 ? trimNumberForExpression(initialAmount).length : 0;
    return { start: caret, end: caret };
  });
  const [memoryValue, setMemoryValue] = useState(0);
  const [memoryHistory, setMemoryHistory] = useState<string[]>([]);
  const [justRecalled, setJustRecalled] = useState(false);
  const result = evaluateCalculatorExpression(expression);

  const updateExpression = (next: string, nextSelection?: TextSelection) => {
    setExpression(next);
    if (nextSelection) setSelection(nextSelection);
    setJustRecalled(false);
    onAmountChange(memoryHistory.length ? memoryValue : evaluateCalculatorExpression(next));
    if (next.trim()) onInteraction?.();
  };

  const handleKey = (key: Key) => {
    if (disabled) return;
    const start = Math.max(0, Math.min(selection.start, expression.length));
    const end = Math.max(start, Math.min(selection.end, expression.length));
    if (key.value === 'C') {
      updateExpression('', { start: 0, end: 0 });
      return;
    }
    if (key.value === 'DEL') {
      if (start !== end) {
        updateExpression(`${expression.slice(0, start)}${expression.slice(end)}`, { start, end: start });
      } else if (start > 0) {
        const caret = start - 1;
        updateExpression(`${expression.slice(0, caret)}${expression.slice(start)}`, { start: caret, end: caret });
      }
      return;
    }
    if (key.value === 'M+' || key.value === 'M-') {
      onInteraction?.();
      const safeValue = result !== null && Number.isFinite(result) ? result : 0;
      const nextMemory = key.value === 'M+' ? memoryValue + safeValue : memoryValue - safeValue;
      setMemoryValue(nextMemory);
      setMemoryHistory((previous) => [...previous, `${key.value}(${formatExpression(expression || '0')})=${nextMemory.toFixed(1)}`]);
      setExpression('');
      setSelection({ start: 0, end: 0 });
      setJustRecalled(false);
      onAmountChange(nextMemory);
      return;
    }
    if (key.value === '=') {
      if (result !== null) {
        onInteraction?.();
        const next = trimNumberForExpression(result);
        updateExpression(next, { start: next.length, end: next.length });
      }
      return;
    }
    const isOperator = ['+', '-', '*', '/'].includes(key.value);
    let replaceStart = start;
    let replaceEnd = end;
    if (isOperator && replaceStart === replaceEnd && /[+\-*/]/.test(expression[replaceStart - 1] ?? '')) {
      replaceStart -= 1;
    }
    if (isOperator && replaceStart === 0) return;
    onInteraction?.();
    const next = `${expression.slice(0, replaceStart)}${key.value}${expression.slice(replaceEnd)}`;
    const caret = replaceStart + key.value.length;
    updateExpression(next, { start: caret, end: caret });
  };

  const handleMemoryRecall = () => {
    playTapSound();
    if (justRecalled) {
      setMemoryValue(0);
      setMemoryHistory([]);
      setJustRecalled(false);
      onAmountChange(evaluateCalculatorExpression(expression));
      return;
    }
    const recalled = trimNumberForExpression(memoryValue);
    onInteraction?.();
    setExpression(recalled);
    setSelection({ start: recalled.length, end: recalled.length });
    setJustRecalled(true);
    onAmountChange(memoryValue);
  };

  const playTapSound = () => {
    try {
      try {
        tapAudioPlayer.currentTime = 0;
      } catch {
        // Playback should still be attempted if the initial seek is unavailable.
      }
      tapAudioPlayer.play();
    } catch {
      // Audio is optional and must not block calculator interactions.
    }
  };

  const partialResult = result ?? (expression
    ? evaluateCalculatorExpression(expression.replace(/[+\-*/]+$/, ''))
    : null);
  const formulaPreview = expression
    ? `${formatExpression(expression)}${partialResult === null ? '' : ` = ${trimNumberForExpression(partialResult)}`}`
    : '';

  const display = (
    <View style={[styles.displayCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.display}>
        <Text style={[styles.currency, { color: currencyColor ?? colors.primary }]}>৳</Text>
        <TextInput
          value={expression}
          onChangeText={updateExpression}
          selection={selection}
          onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
          keyboardType="numbers-and-punctuation"
          showSoftInputOnFocus={false}
          editable={!disabled}
          accessibilityLabel="পরিমাণ লিখুন"
          testID="calculator-expression"
          style={[styles.expressionInput, { color: currencyColor ?? colors.primary }]}
          placeholder="পরিমাণ লিখুন"
          placeholderTextColor={colors.mutedForeground}
        />
      </View>
      {formulaPreview ? (
        <View style={[styles.formulaPreview, { borderTopColor: colors.border }]}>
          <Text style={[styles.formula, { color: colors.mutedForeground }]} numberOfLines={1}>{formulaPreview}</Text>
        </View>
      ) : null}
      {memoryHistory.length > 0 ? (
        <View style={[styles.history, { borderTopColor: colors.border }]}>
          {memoryHistory.slice(-4).map((line, index) => <Text key={`${index}-${line}`} style={[styles.historyLine, { color: colors.mutedForeground }]} numberOfLines={1}>{line}</Text>)}
            <Pressable onPress={handleMemoryRecall} disabled={disabled} accessibilityRole="button" testID="calculator-memory-recall" style={[styles.mrcButton, { backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 }]}>
            <Text style={[styles.mrcText, { color: colors.primaryForeground }]}>MRC = {formatMoney(memoryValue)}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const keypad = (
    <View style={[styles.dockedKeypad, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
      <View style={styles.keypad}>
        {KEYS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keyRow}>
            {row.keys.map((key) => {
              const backgroundColor = key.tone === 'muted'
                ? colors.secondary
                : key.tone === 'operator' ? colors.primary : colors.card;
              const textColor = key.tone === 'operator'
                ? colors.primaryForeground
                : key.tone === 'muted' ? colors.primary : colors.foreground;
              return (
                <Pressable
                  key={key.value}
                  onPress={() => {
                    playTapSound();
                    handleKey(key);
                  }}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={key.label}
                  testID={`calculator-key-${key.value === '=' ? 'equals' : key.value.replace('-', 'minus')}`}
                  style={({ pressed }) => [
                    styles.key,
                    { flex: (key.span ?? 1) * (5 / row.columns), backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.keyLabel, { color: textColor }]}>{key.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );

  if (children) return <>{children({ display, keypad })}</>;

  return (
    <View style={[styles.container, { backgroundColor: colors.secondary }]}>
      {display}
      {keypad}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderRadius: 18, padding: 12, gap: 10 },
  displayCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  display: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 10 },
  currency: { fontSize: 28, fontWeight: '800' },
  expressionInput: { flex: 1, minWidth: 0, height: 48, textAlign: 'left', padding: 0, fontSize: 24, fontWeight: '700' },
  formulaPreview: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2, paddingHorizontal: 8, paddingTop: 7 },
  formula: { width: '100%', textAlign: 'left', fontSize: 13 },
  history: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 4 },
  historyLine: { fontSize: 12, fontVariant: ['tabular-nums'] },
  mrcButton: { minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  mrcText: { fontSize: 14, fontWeight: '800' },
  dockedKeypad: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  keypad: { gap: 7 },
  keyRow: { flexDirection: 'row', gap: 7 },
  key: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: 18, fontWeight: '700' },
});