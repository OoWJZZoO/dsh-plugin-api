export const ATTACHMENT_CONTRACT_SYMBOL = Symbol.for('dsh-plugin-api.attachments.contract')
export const ATTACHMENT_OWNER_SYMBOL = Symbol.for('dsh-plugin-api.attachments.owner')
export const ATTACHMENT_PACKAGE_NAME = '@deepseek-ai/dsh-plugin-api-attachments'
export const ATTACHMENT_ROW_ID = 'plugin-api-attachments'

/**
 * Each replacement instance owns a distinct token.  The token is deliberately
 * not serializable or comparable by value: a stale disposer must never be
 * able to remove a newer instance's marker just because package/row metadata
 * happens to match.
 */
export function createAttachmentOwnerToken() {
  return Object.freeze({ instance: Symbol('attachment-replacement-instance') })
}

export function markAttachmentRoot(root, ownerToken) {
  if (!root || (typeof root !== 'object' && typeof root !== 'function')) return false
  if (!ownerToken || typeof ownerToken !== 'object' || typeof ownerToken.instance !== 'symbol') return false
  const current = root[ATTACHMENT_OWNER_SYMBOL]
  if (current && current.package !== ATTACHMENT_PACKAGE_NAME) return false
  if (current && current.token !== ownerToken) return false
  if (!current) {
    Object.defineProperty(root, ATTACHMENT_OWNER_SYMBOL, {
      configurable: true,
      value: Object.freeze({ package: ATTACHMENT_PACKAGE_NAME, rowId: ATTACHMENT_ROW_ID, token: ownerToken }),
    })
  }
  return true
}

export function ownsAttachmentRoot(root, ownerToken) {
  const marker = root?.[ATTACHMENT_OWNER_SYMBOL]
  return marker?.package === ATTACHMENT_PACKAGE_NAME && marker?.rowId === ATTACHMENT_ROW_ID &&
    (ownerToken === undefined ? Boolean(marker.token) : marker.token === ownerToken)
}
