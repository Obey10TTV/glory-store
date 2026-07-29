const User = require('../models/user')

const updateConnectedAccountStatus = async (user, account) => {
  const profile = user.sellerProfile
  profile.stripeDetailsSubmitted = Boolean(account.details_submitted)
  profile.stripeChargesEnabled = Boolean(account.charges_enabled)
  profile.stripePayoutsEnabled = Boolean(account.payouts_enabled)
  profile.payoutStatus = account.charges_enabled && account.payouts_enabled
    ? 'active'
    : account.details_submitted ? 'restricted' : 'pending'
  profile.payoutStatusUpdatedAt = new Date()
  await user.save()
  return profile.payoutStatus
}

const getSellerCommerceStatus = (user, marketplace) => ({
  activation: {
    required: marketplace.sellerActivationRequired,
    feePence: marketplace.sellerActivationFeePence,
    currency: marketplace.currency,
    status: user.sellerProfile?.activationStatus || 'unpaid',
    paidAt: user.sellerProfile?.activationPaidAt
  },
  payouts: {
    status: user.sellerProfile?.payoutStatus || 'not_started',
    detailsSubmitted: Boolean(user.sellerProfile?.stripeDetailsSubmitted),
    chargesEnabled: Boolean(user.sellerProfile?.stripeChargesEnabled),
    payoutsEnabled: Boolean(user.sellerProfile?.stripePayoutsEnabled)
  },
  acceptedPaymentMethods: user.sellerProfile?.acceptedPaymentMethods || ['card']
})

const transferOrderAllocations = async ({ stripe, order, paymentIntentId, logger }) => {
  if (!stripe || !order?.isPaid || !order.sellerAllocations?.length) return order

  let sourceTransaction = order.paymentSourceId
  if (!sourceTransaction && paymentIntentId) {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge.balance_transaction']
    })
    const charge = paymentIntent.latest_charge
    sourceTransaction = typeof charge === 'string'
      ? paymentIntent.latest_charge
      : charge?.id
    if (sourceTransaction) {
      order.paymentSourceId = sourceTransaction
      const balanceTransaction = typeof charge?.balance_transaction === 'object'
        ? charge.balance_transaction
        : null
      order.processorFeePence = Number(balanceTransaction?.fee || 0)
      order.platformNetPence = Number(order.platformFeeTotalPence || 0) - order.processorFeePence
    }
  }

  for (const allocation of order.sellerAllocations) {
    if (allocation.transferId || allocation.payoutStatus === 'paid') continue

    const sellerId = String(allocation.seller?._id || allocation.seller)
    const seller = await User.findById(sellerId)
    const connectedAccountId = seller?.sellerProfile?.stripeAccountId
    const payoutReady = seller?.sellerProfile?.payoutStatus === 'active'

    if (!seller || !connectedAccountId || !payoutReady) {
      allocation.payoutStatus = 'blocked'
      allocation.payoutFailureReason = 'Seller payout onboarding is incomplete'
      continue
    }

    if (!sourceTransaction) {
      allocation.payoutStatus = 'failed'
      allocation.payoutFailureReason = 'Payment source is unavailable for transfer'
      continue
    }

    try {
      allocation.payoutStatus = 'processing'
      const transfer = await stripe.transfers.create({
        amount: allocation.sellerNetPence,
        currency: 'gbp',
        destination: connectedAccountId,
        source_transaction: sourceTransaction,
        transfer_group: order.transferGroup,
        metadata: {
          orderId: order._id.toString(),
          sellerId
        }
      }, {
        idempotencyKey: `glory-order-${order._id}-seller-${sellerId}`
      })
      allocation.transferId = transfer.id
      allocation.payoutStatus = 'paid'
      allocation.payoutFailureReason = ''
      allocation.paidOutAt = new Date()
    } catch (error) {
      allocation.payoutStatus = 'failed'
      allocation.payoutFailureReason = String(error.message || 'Transfer failed').slice(0, 300)
      logger?.error({
        type: 'SELLER_TRANSFER_FAILED',
        orderId: order._id.toString(),
        sellerId,
        message: error.message
      })
    }
  }

  await order.save()
  return order
}

module.exports = {
  getSellerCommerceStatus,
  transferOrderAllocations,
  updateConnectedAccountStatus
}
