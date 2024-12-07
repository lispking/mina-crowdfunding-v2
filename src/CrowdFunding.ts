import { SmartContract, state, State, PublicKey, UInt64, DeployArgs, Permissions, method, UInt32, AccountUpdate, Provable, Struct, UInt8, Bool } from 'o1js';

export class DeployEvent extends Struct({
  who: PublicKey,
  deadline: UInt32,
  minimumInvestment: UInt64,
  hardCap: UInt64,
  timestamp: UInt32,
}){}

export class ContributedEvent extends Struct({
  who: PublicKey,
  amount: UInt64,
  timestamp: UInt32,
}){}

export class WithdrawnEvent extends Struct({
  who: PublicKey,
  amount: UInt64,
  timestamp: UInt32,
}){}

/**
 * CrowdFunding smart contract
 * See https://docs.minaprotocol.com/zkapps for more info.
 */
export class CrowdFunding extends SmartContract {
  @state(PublicKey) investor = State<PublicKey>();
  @state(UInt32) deadline = State<UInt32>();
  @state(UInt64) minimumInvestment = State<UInt64>();
  @state(UInt64) hardCap = State<UInt64>();
  @state(UInt32) withdrawnCnt = State<UInt32>();

  events = {
    Deploy: DeployEvent,
    Contributed: ContributedEvent,
    Withdrawn: WithdrawnEvent,
  }

  async deploy(args: DeployArgs & {
    deadline: UInt32;
    minimumInvestment: UInt64;
    hardCap: UInt64;
  }) {
    await super.deploy(args);
    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey: Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  
    const sender = this.sender.getAndRequireSignature();
    this.investor.set(sender);
    this.deadline.set(args.deadline);
    this.minimumInvestment.set(args.minimumInvestment);
    this.hardCap.set(args.hardCap);
    this.withdrawnCnt.set(UInt32.from(0));
    this.emitEvent('Deploy', {
      who: sender,
      deadline: args.deadline,
      minimumInvestment: args.minimumInvestment,
      hardCap: args.hardCap,
      timestamp: this.network.blockchainLength.getAndRequireEquals(),
    });
  }

  @method async contribute(amount: UInt64) {
    const sender = this.sender.getAndRequireSignature();
    this.ensureContribution(sender, amount);

    const canContributeAmount = this.calculateAmount(amount);

    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.send({ to: this.address, amount: canContributeAmount });

    this.emitEvent('Contributed', { 
      who: sender, 
      amount: canContributeAmount, 
      timestamp: this.network.blockchainLength.getAndRequireEquals() 
    });
  }

  @method async withdraw() {
    const withdrawPercentage = this.ensureWithdraw();
    const hardCap = this.hardCap.getAndRequireEquals();
    const amountToWithdraw = hardCap.mul(withdrawPercentage).div(UInt64.from(100));

    const sender = this.sender.getAndRequireSignature();
    this.send({ to: sender, amount: amountToWithdraw });

    this.emitEvent('Withdrawn', { 
      who: sender, 
      amount: amountToWithdraw, 
      timestamp: this.network.blockchainLength.getAndRequireEquals() 
    });
  }

  async ensureContribution(sender: PublicKey, amount: UInt64) {
    const currentTime = this.network.blockchainLength.getAndRequireEquals();
    const deadline = this.deadline.getAndRequireEquals();
    currentTime.assertLessThanOrEqual(deadline, "Deadline reached");

    const investor = this.investor.getAndRequireEquals();
    sender.equals(investor).assertFalse("Investor cannot contribute");

    const minimumInvestment = this.minimumInvestment.getAndRequireEquals();
    amount.assertGreaterThanOrEqual(minimumInvestment, "Minimum investment not met");

    const balance = this.account.balance.getAndRequireEquals();
    const hardCap = this.hardCap.getAndRequireEquals();
    balance.assertLessThan(hardCap, "HardCap reached");
  }

  calculateAmount(amount: UInt64) {
    const balance = this.account.balance.getAndRequireEquals();
    const hardCap = this.hardCap.getAndRequireEquals();
    const remaining = hardCap.sub(balance);
    return Provable.if(amount.lessThanOrEqual(remaining), amount, remaining);
  }

  ensureWithdraw() {
    const sender = this.sender.getAndRequireSignature()
    sender.equals(this.investor.getAndRequireEquals()).assertTrue("Only investor can withdraw");
    
    const totalAmount = this.account.balance.getAndRequireEquals();
    totalAmount.assertGreaterThan(UInt64.from(0), "No balance to withdraw");

    const currentTime = this.network.blockchainLength.getAndRequireEquals();
    const deadline = this.deadline.getAndRequireEquals();
    currentTime.assertGreaterThanOrEqual(deadline, "Deadline reached");
    const blocksSinceDeadline = currentTime.sub(deadline);

    const withdrawnCnt = this.withdrawnCnt.getAndRequireEquals();
    const isInitialWithdrawal = withdrawnCnt.equals(UInt32.from(0));

    const withdrawalInterval = withdrawnCnt.mul(200);
    const isSubsequentWithdrawal = blocksSinceDeadline.greaterThanOrEqual(withdrawalInterval);
    Bool.or(isInitialWithdrawal, isSubsequentWithdrawal).assertTrue("Withdrawal not allowed");

    this.incrementWithdrawal();
    return Provable.if(isInitialWithdrawal, UInt64.from(20), UInt64.from(10));
  }

  incrementWithdrawal() {
    this.withdrawnCnt.set(this.withdrawnCnt.get().add(1));
  }

  getInvestor() {
    return this.investor.get();
  }

  getDeadline() {
    return this.deadline.get();
  }

  getMinimumInvestment() {
    return this.minimumInvestment.get();
  }

  getHardCap() {
    return this.hardCap.get();
  }
}
