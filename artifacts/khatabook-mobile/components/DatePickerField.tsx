import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { formatPickerDate, getCalendarDays, parseLocalIsoDate, toLocalIsoDate } from '@/lib/datePicker';

const WEEKDAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

export function DatePickerField({
  label,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [displayMonth, setDisplayMonth] = useState(() => parseLocalIsoDate(value) ?? new Date());
  const year = displayMonth.getFullYear();
  const month = displayMonth.getMonth();
  const days = useMemo(() => getCalendarDays(year, month), [year, month]);
  const selectedDate = parseLocalIsoDate(value);
  const monthLabel = displayMonth.toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' });
  const today = toLocalIsoDate(new Date());

  const open = () => {
    setDisplayMonth(parseLocalIsoDate(value) ?? new Date());
    setVisible(true);
  };

  const changeMonth = (delta: number) => {
    setDisplayMonth((previous) => new Date(previous.getFullYear(), previous.getMonth() + delta, 1));
  };

  return (
    <>
      <View style={{ gap: 6 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '700' }}>{label}</Text>
        <Pressable
          onPress={open}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${formatPickerDate(value) || 'তারিখ বাছুন'}`}
          testID={testID}
          style={({ pressed }) => ({
            minHeight: 48,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 13,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            backgroundColor: colors.card,
            opacity: disabled ? 0.55 : pressed ? 0.72 : 1,
          })}
        >
          <Feather name="calendar" size={17} color={colors.primary} />
          <Text style={{ flex: 1, color: value ? colors.foreground : colors.mutedForeground, fontSize: 14, fontWeight: '600' }}>
            {formatPickerDate(value) || 'তারিখ বাছুন'}
          </Text>
          <Feather name="chevron-down" size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
        statusBarTranslucent
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            onPress={() => setVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="তারিখ বাছাই বন্ধ করুন"
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.foreground, opacity: 0.42 }}
          />
          <View
            style={{
              maxHeight: '78%',
              paddingHorizontal: 18,
              paddingTop: 16,
              paddingBottom: Math.max(insets.bottom, 16),
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              backgroundColor: colors.card,
              gap: 14,
            }}
          >
            <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '800' }}>তারিখ বাছুন</Text>
              <Pressable
                onPress={() => setVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="বন্ধ করুন"
                hitSlop={10}
                style={{ padding: 5 }}
              >
                <Feather name="x" size={21} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable onPress={() => changeMonth(-1)} accessibilityRole="button" accessibilityLabel="আগের মাস" testID="date-picker-previous-month" hitSlop={8} style={{ padding: 8 }}>
                <Feather name="chevron-left" size={22} color={colors.foreground} />
              </Pressable>
              <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: '800' }}>{monthLabel}</Text>
              <Pressable onPress={() => changeMonth(1)} accessibilityRole="button" accessibilityLabel="পরের মাস" testID="date-picker-next-month" hitSlop={8} style={{ padding: 8 }}>
                <Feather name="chevron-right" size={22} color={colors.foreground} />
              </Pressable>
            </View>

            <ScrollView bounces={false} contentContainerStyle={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', marginBottom: 3 }}>
                {WEEKDAYS.map((weekday) => (
                  <Text key={weekday} style={{ flex: 1, textAlign: 'center', color: colors.mutedForeground, fontSize: 11, fontWeight: '700' }}>
                    {weekday}
                  </Text>
                ))}
              </View>
              {Array.from({ length: 6 }, (_, week) => (
                <View key={week} style={{ flexDirection: 'row' }}>
                  {days.slice(week * 7, week * 7 + 7).map((day, weekday) => {
                    if (!day) return <View key={`empty-${week}-${weekday}`} style={{ flex: 1, height: 42 }} />;
                    const dateKey = toLocalIsoDate(day);
                    const selected = dateKey === value;
                    const isToday = dateKey === today;
                    return (
                      <Pressable
                        key={dateKey}
                        onPress={() => {
                          onChange(dateKey);
                          setVisible(false);
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={formatPickerDate(dateKey)}
                        testID={`date-picker-day-${dateKey}`}
                        style={({ pressed }) => ({
                          flex: 1,
                          height: 42,
                          alignItems: 'center',
                          justifyContent: 'center',
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderWidth: isToday && !selected ? 1 : 0,
                            borderColor: colors.primary,
                            backgroundColor: selected ? colors.primary : 'transparent',
                          }}
                        >
                          <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 14, fontWeight: selected || isToday ? '800' : '500' }}>
                            {day.getDate()}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => {
                  onChange(today);
                  setVisible(false);
                }}
                accessibilityRole="button"
                testID="date-picker-today"
                style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: colors.secondary }}
              >
                <Text style={{ color: colors.primary, fontWeight: '800' }}>আজ</Text>
              </Pressable>
              {value ? (
                <Pressable
                  onPress={() => {
                    onChange('');
                    setVisible(false);
                  }}
                  accessibilityRole="button"
                  testID="date-picker-clear"
                  style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 11 }}
                >
                  <Text style={{ color: colors.mutedForeground, fontWeight: '700' }}>তারিখ সরান</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}