type PhoneAuthResponse = {
  authMethod?: string;
  userId?: string;
};

export function hasVerifiedPhoneSession(
  data: PhoneAuthResponse | undefined,
  status?: number,
): boolean {
  return data?.authMethod === 'phone'
    && Boolean(data.userId)
    && status !== 401
    && status !== 403;
}
