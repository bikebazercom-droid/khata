import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppButton, LoadingState, Notice } from '@/components/Kit';
import { useBusinessScope } from '@/contexts/BusinessScopeContext';
import { errorMessage, toBengaliDigits } from '@/lib/domain';
import { useColors } from '@/hooks/useColors';

const AVATAR_COLORS = ['#1B3A6B', '#0052B4', '#065F46', '#7C3AED', '#B45309', '#DC2626'];

function businessInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase() || 'খ';
}

export function BusinessSwitcherModal() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    businesses,
    selectedBusinessId,
    isSwitcherOpen,
    closeBusinessSwitcher,
    isLoadingBusinesses,
    businessesError,
    refreshBusinesses,
    switchBusiness,
  } = useBusinessScope();
  const [switchError, setSwitchError] = useState('');

  const chooseBusiness = async (businessId: string) => {
    setSwitchError('');
    try {
      await switchBusiness(businessId);
    } catch (error) {
      setSwitchError(errorMessage(error, 'খাতা বদলানো যায়নি। আবার চেষ্টা করুন।'));
    }
  };

  return (
    <Modal
      visible={isSwitcherOpen}
      transparent
      animationType="slide"
      onRequestClose={closeBusinessSwitcher}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="খাতা বাছাই বন্ধ করুন"
          onPress={closeBusinessSwitcher}
          style={{ flex: 1 }}
        />
        <View
          style={{
            maxHeight: '82%',
            paddingHorizontal: 18,
            paddingTop: 14,
            paddingBottom: Math.max(insets.bottom, 20),
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            backgroundColor: colors.card,
            gap: 13,
          }}
        >
          <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.foreground, fontSize: 19, fontWeight: '800' }}>আপনার খাতাগুলো</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 2 }}>একবারে একটি খাতার হিসাব দেখানো হয়</Text>
            </View>
            <Pressable
              onPress={closeBusinessSwitcher}
              accessibilityRole="button"
              accessibilityLabel="বন্ধ করুন"
              testID="business-switcher-close"
              hitSlop={10}
              style={{ padding: 7 }}
            >
              <Feather name="x" size={21} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {isLoadingBusinesses ? <LoadingState label="খাতাগুলো লোড হচ্ছে…" /> : null}
          {businessesError ? (
            <Notice
              message={errorMessage(businessesError, 'খাতাগুলো লোড করা যায়নি।')}
              onRetry={() => { void refreshBusinesses(); }}
            />
          ) : null}
          {switchError ? <Notice message={switchError} /> : null}

          <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
            {businesses.map((business, index) => {
              const selected = business.id === selectedBusinessId;
              const color = AVATAR_COLORS[index % AVATAR_COLORS.length]!;
              return (
                <Pressable
                  key={business.id}
                  onPress={() => { void chooseBusiness(business.id); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  testID={`business-option-${business.id}`}
                  style={({ pressed }) => ({
                    minHeight: 74,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 12,
                    borderRadius: 15,
                    borderWidth: 2,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected ? `${colors.primary}0C` : colors.card,
                    opacity: pressed ? 0.78 : 1,
                  })}
                >
                  <View style={{ width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: color }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>{businessInitials(business.name)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{business.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                      {toBengaliDigits(String(business.partyCount))}টি হিসাব
                    </Text>
                  </View>
                  <Feather name={selected ? 'check-circle' : 'circle'} size={21} color={selected ? colors.primary : colors.border} />
                </Pressable>
              );
            })}
          </ScrollView>

          {!isLoadingBusinesses && !businessesError && businesses.length === 0 ? (
            <Notice message="এই অ্যাকাউন্টে অন্য কোনো খাতা পাওয়া যায়নি।" tone="info" />
          ) : null}
          <AppButton title="বন্ধ করুন" variant="secondary" onPress={closeBusinessSwitcher} testID="business-switcher-dismiss" />
        </View>
      </View>
    </Modal>
  );
}