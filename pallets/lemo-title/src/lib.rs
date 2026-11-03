//! Native LEMO title registry.
//!
//! This pallet is the native half of the protocol: one record per title, a
//! monotonic revision, and the unbond guard that refuses to release backing
//! while an EVM representation is live. The EVM gates read the same record out
//! of a state proof; this pallet is what writes it.
//!
//! Lifecycle:
//! - `create_title` reserves `TitleDeposit` from the caller and derives the
//!   title id as `blake2_256(SCALE(owner, salt))`, so nobody can register an
//!   id that belongs to another account (no squatting or front-running).
//! - `request_unbond` (owner, representation explicitly not live) starts an
//!   `UnbondingPeriod`. The title stays in storage and stays provable, but it
//!   is frozen: no call that bumps the revision is accepted.
//! - `cancel_unbond` (owner) lifts the freeze at any time before finalization.
//! - `finalize_unbond` (anyone, after the period) re-checks that the
//!   representation is still explicitly not live, deletes the record and
//!   returns the deposit.
//!
//! It is source and tests only. Including it in a runtime and deploying that
//! runtime is a chain upgrade, not a website change.

#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
  use frame_support::{
    pallet_prelude::*,
    traits::{Currency, ReservableCurrency},
  };
  use frame_system::pallet_prelude::*;
  use sp_runtime::{
    traits::{BlakeTwo256, Hash as HashT},
    Saturating,
  };

  pub type BalanceOf<T> =
    <<T as Config>::Currency as Currency<<T as frame_system::Config>::AccountId>>::Balance;

  /// The ten-field record the EVM commitment is computed over.
  #[derive(Clone, Eq, PartialEq, Encode, Decode, TypeInfo, MaxEncodedLen, Debug)]
  pub struct TitleRecord<AccountId, Hash> {
    pub title_id: Hash,
    pub chain_id: u64,
    pub native_asset: Hash,
    pub backing: Hash,
    pub owner: AccountId,
    /// The EVM address that owns the representation. Kept explicit rather than
    /// truncating `AccountId32`; the native account and the EVM beneficiary are
    /// different namespaces.
    pub evm_beneficiary: [u8; 20],
    pub identity_hash: Hash,
    pub vesting_hash: Hash,
    pub permissions_hash: Hash,
    pub evm_contract: [u8; 20],
    pub revision: u64,
  }

  #[pallet::pallet]
  pub struct Pallet<T>(_);

  #[pallet::config]
  pub trait Config: frame_system::Config<RuntimeEvent: From<Event<Self>>> {
    /// The origin allowed to mirror representation liveness from the EVM side.
    type AdminOrigin: EnsureOrigin<Self::RuntimeOrigin>;
    /// Currency used for the per-title storage deposit.
    type Currency: ReservableCurrency<Self::AccountId>;
    /// Reserved from the creator on `create_title`, returned on `finalize_unbond`.
    #[pallet::constant]
    type TitleDeposit: Get<BalanceOf<Self>>;
    /// Blocks between `request_unbond` and the earliest `finalize_unbond`.
    #[pallet::constant]
    type UnbondingPeriod: Get<BlockNumberFor<Self>>;
  }

  #[pallet::storage]
  pub type Titles<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, TitleRecord<T::AccountId, T::Hash>, OptionQuery>;

  /// The fixed-width record the EVM decoder reads: ten 32-byte words, 320 bytes.
  ///
  /// `Titles` keeps the native struct (SCALE encodes it at 280 bytes with a
  /// 32-byte AccountId). EVM cannot decode that shape, so every write also
  /// stores this canonical blob under its own key. The blob is the value a
  /// storage proof for `CanonicalTitles` returns.
  #[pallet::storage]
  pub type CanonicalTitles<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, [u8; 320], OptionQuery>;

  /// Mirrors whether an EVM representation currently has supply. The native
  /// chain cannot read EVM storage, so the bridge/runtime API writes this flag.
  ///
  /// `OptionQuery` is deliberate: an unwritten flag means "unknown", and an
  /// unknown representation is treated as live. Only an explicit `Some(false)`
  /// can authorise a native unbond.
  #[pallet::storage]
  pub type RepresentationLive<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, bool, OptionQuery>;

  /// Titles with a pending unbond, keyed to the first block at which
  /// `finalize_unbond` is accepted. A title in this map is frozen.
  #[pallet::storage]
  pub type Unbonding<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, BlockNumberFor<T>, OptionQuery>;

  /// Who paid the storage deposit for a title and how much. Kept apart from
  /// the record so an ownership transfer or a deposit change in a later
  /// runtime cannot refund the wrong account or the wrong amount.
  #[pallet::storage]
  pub type TitleDeposits<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, (T::AccountId, BalanceOf<T>), OptionQuery>;

  #[pallet::event]
  #[pallet::generate_deposit(pub(super) fn deposit_event)]
  pub enum Event<T: Config> {
    TitleCreated {
      title_id: T::Hash,
      owner: T::AccountId,
      revision: u64,
    },
    TitleUpdated {
      title_id: T::Hash,
      revision: u64,
    },
    RepresentationChanged {
      title_id: T::Hash,
      contract: [u8; 20],
      revision: u64,
    },
    RepresentationLiveChanged {
      title_id: T::Hash,
      live: bool,
    },
    UnbondRequested {
      title_id: T::Hash,
      at: BlockNumberFor<T>,
    },
    UnbondCancelled {
      title_id: T::Hash,
    },
    Unbonded {
      title_id: T::Hash,
    },
  }

  #[pallet::error]
  pub enum Error<T> {
    TitleExists,
    TitleMissing,
    NotOwner,
    RepresentationLive,
    RevisionOverflow,
    /// The title is unbonding; edits are refused until `cancel_unbond`.
    TitleFrozen,
    AlreadyUnbonding,
    NotUnbonding,
    /// `finalize_unbond` was called before the unbonding period elapsed.
    UnbondingNotDue,
    /// The runtime hash type cannot hold a 32-byte blake2 digest.
    BadHashType,
  }

  /// Hand-written weights. There is no benchmarking run behind these; they
  /// charge every storage access through `T::DbWeight` plus a fixed compute
  /// base, and a proof-size estimate of the worst-case key + value for every
  /// item read (relevant for PoV-bounded chains).
  pub mod weights {
    use super::*;

    /// Twox128(pallet) ++ Twox128(item) ++ Blake2_128Concat(H256).
    const MAP_KEY: u64 = 32 + 16 + 32;
    /// Trie path overhead per proven item (rough; ~ a few branch nodes).
    const TRIE_PATH: u64 = 512;
    /// `System::Account` entry estimate used by pallet_balances benchmarks.
    const ACCOUNT: u64 = 3_593;

    fn item<V: MaxEncodedLen>() -> u64 {
      MAP_KEY + TRIE_PATH + V::max_encoded_len() as u64
    }
    fn title<T: Config>() -> u64 {
      item::<TitleRecord<T::AccountId, T::Hash>>()
    }

    fn build<T: Config>(base_ref: u64, reads: u64, writes: u64, proof: u64) -> Weight {
      Weight::from_parts(base_ref, proof).saturating_add(T::DbWeight::get().reads_writes(reads, writes))
    }

    /// R: Titles, System::Account. W: Titles, CanonicalTitles, TitleDeposits, System::Account.
    pub fn create_title<T: Config>() -> Weight {
      build::<T>(40_000_000, 2, 4, title::<T>() + ACCOUNT)
    }
    /// R: Titles, Unbonding. W: Titles, CanonicalTitles.
    pub fn edit<T: Config>() -> Weight {
      build::<T>(20_000_000, 2, 2, title::<T>() + item::<BlockNumberFor<T>>())
    }
    /// R: Titles. W: RepresentationLive.
    pub fn set_representation_live<T: Config>() -> Weight {
      build::<T>(12_000_000, 1, 1, title::<T>())
    }
    /// R: Titles, RepresentationLive, Unbonding. W: Unbonding.
    pub fn request_unbond<T: Config>() -> Weight {
      build::<T>(15_000_000, 3, 1, title::<T>() + item::<bool>() + item::<BlockNumberFor<T>>())
    }
    /// R: Titles, Unbonding. W: Unbonding.
    pub fn cancel_unbond<T: Config>() -> Weight {
      build::<T>(12_000_000, 2, 1, title::<T>() + item::<BlockNumberFor<T>>())
    }
    /// R: Titles, Unbonding, RepresentationLive, TitleDeposits, System::Account.
    /// W: Titles, CanonicalTitles, RepresentationLive, Unbonding, TitleDeposits, System::Account.
    pub fn finalize_unbond<T: Config>() -> Weight {
      build::<T>(
        45_000_000,
        5,
        6,
        title::<T>()
          + item::<BlockNumberFor<T>>()
          + item::<bool>()
          + item::<(T::AccountId, BalanceOf<T>)>()
          + ACCOUNT,
      )
    }
  }

  #[pallet::call]
  impl<T: Config> Pallet<T> {
    /// Register a title. The id is `blake2_256(SCALE(caller, salt))`; it is
    /// derived here, never chosen by the caller, so an id is only ever
    /// registrable by the account it was derived from.
    #[pallet::call_index(0)]
    #[pallet::weight(weights::create_title::<T>())]
    pub fn create_title(
      origin: OriginFor<T>,
      salt: [u8; 32],
      chain_id: u64,
      native_asset: T::Hash,
      backing: T::Hash,
      identity_hash: T::Hash,
      vesting_hash: T::Hash,
      permissions_hash: T::Hash,
      evm_beneficiary: [u8; 20],
    ) -> DispatchResult {
      let owner = ensure_signed(origin)?;
      let title_id = Self::derive_title_id(&owner, &salt)?;
      ensure!(!Titles::<T>::contains_key(title_id), Error::<T>::TitleExists);

      let deposit = T::TitleDeposit::get();
      T::Currency::reserve(&owner, deposit)?;

      let record = TitleRecord {
        title_id,
        chain_id,
        native_asset,
        backing,
        owner: owner.clone(),
        evm_beneficiary,
        identity_hash,
        vesting_hash,
        permissions_hash,
        evm_contract: [0u8; 20],
        revision: 1,
      };

      Titles::<T>::insert(title_id, &record);
      CanonicalTitles::<T>::insert(title_id, Self::canonical(&record));
      TitleDeposits::<T>::insert(title_id, (owner.clone(), deposit));
      Self::deposit_event(Event::TitleCreated { title_id, owner, revision: 1 });
      Ok(())
    }

    #[pallet::call_index(1)]
    #[pallet::weight(weights::edit::<T>())]
    pub fn set_identity(
      origin: OriginFor<T>,
      title_id: T::Hash,
      identity_hash: T::Hash,
    ) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let record = Self::mutate_owned(title_id, &who, |record| {
        record.identity_hash = identity_hash;
        Ok(())
      })?;
      Self::deposit_event(Event::TitleUpdated { title_id, revision: record.revision });
      Ok(())
    }

    #[pallet::call_index(2)]
    #[pallet::weight(weights::edit::<T>())]
    pub fn set_representation(
      origin: OriginFor<T>,
      title_id: T::Hash,
      evm_contract: [u8; 20],
    ) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let record = Self::mutate_owned(title_id, &who, |record| {
        record.evm_contract = evm_contract;
        Ok(())
      })?;
      Self::deposit_event(Event::RepresentationChanged {
        title_id,
        contract: evm_contract,
        revision: record.revision,
      });
      Ok(())
    }

    /// Mirrors the EVM supply flag. Only the configured admin origin can write
    /// it, because the native chain cannot observe EVM balances by itself.
    /// Deliberately allowed while unbonding: flipping it to `true` blocks the
    /// pending finalization.
    #[pallet::call_index(3)]
    #[pallet::weight(weights::set_representation_live::<T>())]
    pub fn set_representation_live(
      origin: OriginFor<T>,
      title_id: T::Hash,
      live: bool,
    ) -> DispatchResult {
      T::AdminOrigin::ensure_origin(origin)?;
      ensure!(Titles::<T>::contains_key(title_id), Error::<T>::TitleMissing);
      RepresentationLive::<T>::insert(title_id, live);
      Self::deposit_event(Event::RepresentationLiveChanged { title_id, live });
      Ok(())
    }

    /// Rule 2, phase 1: start the unbonding period. Requires the
    /// representation to be explicitly not live. Does not delete anything;
    /// the title stays provable and is frozen until cancel or finalize.
    #[pallet::call_index(4)]
    #[pallet::weight(weights::request_unbond::<T>())]
    pub fn request_unbond(origin: OriginFor<T>, title_id: T::Hash) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let record = Titles::<T>::get(title_id).ok_or(Error::<T>::TitleMissing)?;
      ensure!(record.owner == who, Error::<T>::NotOwner);
      ensure!(!Unbonding::<T>::contains_key(title_id), Error::<T>::AlreadyUnbonding);
      ensure!(
        RepresentationLive::<T>::get(title_id) == Some(false),
        Error::<T>::RepresentationLive
      );

      let at = frame_system::Pallet::<T>::block_number().saturating_add(T::UnbondingPeriod::get());
      Unbonding::<T>::insert(title_id, at);
      Self::deposit_event(Event::UnbondRequested { title_id, at });
      Ok(())
    }

    #[pallet::call_index(5)]
    #[pallet::weight(weights::edit::<T>())]
    pub fn transfer_owner(
      origin: OriginFor<T>,
      title_id: T::Hash,
      next: T::AccountId,
    ) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let record = Self::mutate_owned(title_id, &who, |record| {
        record.owner = next;
        Ok(())
      })?;
      Self::deposit_event(Event::TitleUpdated { title_id, revision: record.revision });
      Ok(())
    }

    /// Rule 2, phase 2 (optional): the owner withdraws a pending unbond.
    #[pallet::call_index(6)]
    #[pallet::weight(weights::cancel_unbond::<T>())]
    pub fn cancel_unbond(origin: OriginFor<T>, title_id: T::Hash) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let record = Titles::<T>::get(title_id).ok_or(Error::<T>::TitleMissing)?;
      ensure!(record.owner == who, Error::<T>::NotOwner);
      ensure!(Unbonding::<T>::contains_key(title_id), Error::<T>::NotUnbonding);
      Unbonding::<T>::remove(title_id);
      Self::deposit_event(Event::UnbondCancelled { title_id });
      Ok(())
    }

    /// Rule 2, phase 3: anyone may finalize once the period has elapsed. The
    /// liveness flag is re-checked here; a representation that came back to
    /// life during the period blocks deletion.
    #[pallet::call_index(7)]
    #[pallet::weight(weights::finalize_unbond::<T>())]
    pub fn finalize_unbond(origin: OriginFor<T>, title_id: T::Hash) -> DispatchResult {
      ensure_signed(origin)?;
      ensure!(Titles::<T>::contains_key(title_id), Error::<T>::TitleMissing);
      let at = Unbonding::<T>::get(title_id).ok_or(Error::<T>::NotUnbonding)?;
      ensure!(frame_system::Pallet::<T>::block_number() >= at, Error::<T>::UnbondingNotDue);
      ensure!(
        RepresentationLive::<T>::get(title_id) == Some(false),
        Error::<T>::RepresentationLive
      );

      Titles::<T>::remove(title_id);
      CanonicalTitles::<T>::remove(title_id);
      RepresentationLive::<T>::remove(title_id);
      Unbonding::<T>::remove(title_id);
      if let Some((depositor, amount)) = TitleDeposits::<T>::take(title_id) {
        let _ = T::Currency::unreserve(&depositor, amount);
      }
      Self::deposit_event(Event::Unbonded { title_id });
      Ok(())
    }
  }

  impl<T: Config> Pallet<T> {
    /// `blake2_256(SCALE((owner, salt)))`, as `T::Hash`. For `AccountId32`
    /// this is `blake2_256(owner_pubkey ++ salt)`.
    pub fn derive_title_id(owner: &T::AccountId, salt: &[u8; 32]) -> Result<T::Hash, DispatchError> {
      let digest: [u8; 32] = BlakeTwo256::hash_of(&(owner, salt)).0;
      let id = T::Hash::decode(&mut &digest[..]).map_err(|_| Error::<T>::BadHashType)?;
      ensure!(id.as_ref() == &digest[..], Error::<T>::BadHashType);
      Ok(id)
    }

    /// Owner-only edit that bumps the revision. Refused while unbonding.
    fn mutate_owned(
      title_id: T::Hash,
      who: &T::AccountId,
      change: impl FnOnce(&mut TitleRecord<T::AccountId, T::Hash>) -> DispatchResult,
    ) -> Result<TitleRecord<T::AccountId, T::Hash>, DispatchError> {
      let mut record = Titles::<T>::get(title_id).ok_or(Error::<T>::TitleMissing)?;
      ensure!(&record.owner == who, Error::<T>::NotOwner);
      ensure!(!Unbonding::<T>::contains_key(title_id), Error::<T>::TitleFrozen);
      change(&mut record)?;
      record.revision = record
        .revision
        .checked_add(1)
        .ok_or(Error::<T>::RevisionOverflow)?;
      Titles::<T>::insert(title_id, &record);
      CanonicalTitles::<T>::insert(title_id, Self::canonical(&record));
      Ok(record)
    }

    /// Ten 32-byte big-endian words. Layout is consumed by the EVM decoder
    /// and fixtures; do not change it.
    pub fn canonical(record: &TitleRecord<T::AccountId, T::Hash>) -> [u8; 320] {
      let mut out = [0u8; 320];
      out[..32].copy_from_slice(&record.title_id.encode());
      out[56..64].copy_from_slice(&record.chain_id.to_be_bytes());
      out[64..96].copy_from_slice(&record.native_asset.encode());
      out[96..128].copy_from_slice(&record.backing.encode());
      out[140..160].copy_from_slice(&record.evm_beneficiary);
      out[160..192].copy_from_slice(&record.identity_hash.encode());
      out[192..224].copy_from_slice(&record.vesting_hash.encode());
      out[224..256].copy_from_slice(&record.permissions_hash.encode());
      out[268..288].copy_from_slice(&record.evm_contract);
      out[312..320].copy_from_slice(&record.revision.to_be_bytes());
      out
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::pallet as lemo_title;
  use frame_support::{
    assert_noop, assert_ok, derive_impl, parameter_types,
    traits::ConstU64,
    Hashable,
  };
  use sp_core::H256;
  use sp_runtime::BuildStorage;

  type Block = frame_system::mocking::MockBlock<Test>;

  frame_support::construct_runtime!(
    pub enum Test {
      System: frame_system,
      Balances: pallet_balances,
      LemoTitle: lemo_title,
    }
  );

  #[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
  impl frame_system::Config for Test {
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
    type AccountData = pallet_balances::AccountData<u64>;
  }

  #[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
  impl pallet_balances::Config for Test {
    type AccountStore = System;
  }

  const DEPOSIT: u64 = 100;
  const PERIOD: u64 = 10;

  parameter_types! {
    pub const TitleDeposit: u64 = DEPOSIT;
  }

  impl crate::pallet::Config for Test {
    type AdminOrigin = frame_system::EnsureRoot<u64>;
    type Currency = Balances;
    type TitleDeposit = TitleDeposit;
    type UnbondingPeriod = ConstU64<PERIOD>;
  }

  fn new_test_ext() -> sp_io::TestExternalities {
    let mut t = frame_system::GenesisConfig::<Test>::default().build_storage().unwrap();
    pallet_balances::GenesisConfig::<Test> {
      balances: vec![(1, 1_000), (2, 1_000), (3, 50)],
      ..Default::default()
    }
    .assimilate_storage(&mut t)
    .unwrap();
    let mut ext: sp_io::TestExternalities = t.into();
    ext.execute_with(|| System::set_block_number(1));
    ext
  }

  fn h(n: u64) -> H256 {
    H256::from_low_u64_be(n)
  }

  fn salt(n: u8) -> [u8; 32] {
    [n; 32]
  }

  fn id(owner: u64, s: u8) -> H256 {
    LemoTitle::derive_title_id(&owner, &salt(s)).unwrap()
  }

  /// Create a title for `owner` with salt `s` and return its id.
  fn create(owner: u64, s: u8) -> H256 {
    assert_ok!(LemoTitle::create_title(
      RuntimeOrigin::signed(owner),
      salt(s),
      420420777,
      h(2),
      h(3),
      h(4),
      h(5),
      h(6),
      [7u8; 20]
    ));
    id(owner, s)
  }

  fn set_live(t: H256, live: bool) {
    assert_ok!(LemoTitle::set_representation_live(RuntimeOrigin::root(), t, live));
  }

  #[test]
  fn creates_a_title_at_revision_one() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      let record = crate::Titles::<Test>::get(t).expect("title exists");
      assert_eq!(record.title_id, t);
      assert_eq!(record.owner, 1);
      assert_eq!(record.revision, 1);
      assert_eq!(record.evm_contract, [0u8; 20]);
      assert_eq!(record.evm_beneficiary, [7u8; 20]);
    });
  }

  #[test]
  fn title_id_is_blake2_of_scale_owner_and_salt() {
    new_test_ext().execute_with(|| {
      let expected = H256((1u64, salt(9)).blake2_256());
      assert_eq!(id(1, 9), expected);
      // Explicitly: SCALE(u64 owner) ++ salt.
      let mut raw = 1u64.to_le_bytes().to_vec();
      raw.extend_from_slice(&salt(9));
      assert_eq!(expected, H256(sp_io::hashing::blake2_256(&raw)));
      assert_ne!(id(1, 9), id(2, 9));
    });
  }

  /// Shared vector with scripts/local-capture.mjs: //Alice + salt 0xee00..00.
  #[test]
  fn title_id_matches_the_capture_script_for_account_id32() {
    use sp_runtime::traits::{BlakeTwo256, Hash as _};
    let alice = sp_core::crypto::AccountId32::new(hex32(
      "d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    ));
    let mut s = [0u8; 32];
    s[0] = 0xee;
    assert_eq!(
      BlakeTwo256::hash_of(&(&alice, &s)).0,
      hex32("1df5ca0bcc3ab81c34cc1719c300e6233c15ee33e5f61f9dcdb50a9965908ded")
    );
  }

  fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
      out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
  }

  #[test]
  fn same_salt_from_another_account_cannot_squat_the_id() {
    new_test_ext().execute_with(|| {
      // Attacker front-runs with the victim's salt: gets a *different* id.
      let attacker = create(2, 1);
      let victim = create(1, 1);
      assert_ne!(attacker, victim);
      assert_eq!(crate::Titles::<Test>::get(victim).unwrap().owner, 1);
      assert_eq!(crate::Titles::<Test>::get(attacker).unwrap().owner, 2);
    });
  }

  #[test]
  fn refuses_duplicate_title() {
    new_test_ext().execute_with(|| {
      create(1, 1);
      assert_noop!(
        LemoTitle::create_title(
          RuntimeOrigin::signed(1),
          salt(1),
          1,
          h(2),
          h(3),
          h(4),
          h(5),
          h(6),
          [0u8; 20]
        ),
        Error::<Test>::TitleExists
      );
    });
  }

  #[test]
  fn create_reserves_the_deposit_and_refuses_without_funds() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_eq!(Balances::reserved_balance(1), DEPOSIT);
      assert_eq!(Balances::free_balance(1), 1_000 - DEPOSIT);
      assert_eq!(crate::TitleDeposits::<Test>::get(t), Some((1, DEPOSIT)));

      // Account 3 holds 50 < deposit.
      assert!(LemoTitle::create_title(
        RuntimeOrigin::signed(3),
        salt(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6),
        [0u8; 20]
      )
      .is_err());
      assert!(crate::Titles::<Test>::get(id(3, 1)).is_none());
      assert_eq!(Balances::reserved_balance(3), 0);
    });
  }

  #[test]
  fn owner_edit_bumps_revision_and_stranger_cannot() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_ok!(LemoTitle::set_identity(RuntimeOrigin::signed(1), t, h(9)));
      assert_eq!(crate::Titles::<Test>::get(t).unwrap().revision, 2);

      assert_noop!(
        LemoTitle::set_identity(RuntimeOrigin::signed(2), t, h(10)),
        Error::<Test>::NotOwner
      );
    });
  }

  #[test]
  fn representation_change_bumps_revision() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_ok!(LemoTitle::set_representation(RuntimeOrigin::signed(1), t, [1u8; 20]));
      let record = crate::Titles::<Test>::get(t).expect("title exists");
      assert_eq!(record.revision, 2);
      assert_eq!(record.evm_contract, [1u8; 20]);
    })
  }

  #[test]
  fn canonical_blob_keeps_the_ten_word_layout() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_ok!(LemoTitle::set_representation(RuntimeOrigin::signed(1), t, [0x11u8; 20]));
      let c = crate::CanonicalTitles::<Test>::get(t).expect("canonical record");
      assert_eq!(c.len(), 320);
      assert_eq!(&c[0..32], t.as_bytes());
      assert_eq!(&c[32..56], &[0u8; 24]);
      assert_eq!(&c[56..64], &420420777u64.to_be_bytes());
      assert_eq!(&c[64..96], h(2).as_bytes());
      assert_eq!(&c[96..128], h(3).as_bytes());
      assert_eq!(&c[128..140], &[0u8; 12]);
      assert_eq!(&c[140..160], &[7u8; 20]);
      assert_eq!(&c[160..192], h(4).as_bytes());
      assert_eq!(&c[192..224], h(5).as_bytes());
      assert_eq!(&c[224..256], h(6).as_bytes());
      assert_eq!(&c[256..268], &[0u8; 12]);
      assert_eq!(&c[268..288], &[0x11u8; 20]);
      assert_eq!(&c[288..312], &[0u8; 24]);
      assert_eq!(&c[312..320], &2u64.to_be_bytes());

      // Storage key unchanged: twox128("LemoTitle") ++ twox128("CanonicalTitles")
      // ++ blake2_128(title_id) ++ title_id.
      let mut key = sp_io::hashing::twox_128(b"LemoTitle").to_vec();
      key.extend_from_slice(&sp_io::hashing::twox_128(b"CanonicalTitles"));
      key.extend_from_slice(&sp_io::hashing::blake2_128(t.as_bytes()));
      key.extend_from_slice(t.as_bytes());
      assert_eq!(crate::CanonicalTitles::<Test>::hashed_key_for(t), key);
      assert_eq!(sp_io::storage::get(&key).map(|v| v.len()), Some(320));
    })
  }

  #[test]
  fn unbond_is_refused_while_representation_is_live() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      set_live(t, true);
      assert_noop!(
        LemoTitle::request_unbond(RuntimeOrigin::signed(1), t),
        Error::<Test>::RepresentationLive
      );
      assert!(crate::Titles::<Test>::get(t).is_some());
    })
  }

  #[test]
  fn unbond_is_refused_while_representation_state_is_unknown() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_noop!(
        LemoTitle::request_unbond(RuntimeOrigin::signed(1), t),
        Error::<Test>::RepresentationLive
      );
    })
  }

  #[test]
  fn only_the_owner_can_request_unbond() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      set_live(t, false);
      assert_noop!(
        LemoTitle::request_unbond(RuntimeOrigin::signed(2), t),
        Error::<Test>::NotOwner
      );
    })
  }

  #[test]
  fn request_unbond_does_not_delete_and_records_the_due_block() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      set_live(t, false);
      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(1), t));
      assert_eq!(crate::Unbonding::<Test>::get(t), Some(1 + PERIOD));
      assert!(crate::Titles::<Test>::get(t).is_some());
      assert!(crate::CanonicalTitles::<Test>::get(t).is_some());
      assert_eq!(Balances::reserved_balance(1), DEPOSIT);
      assert_noop!(
        LemoTitle::request_unbond(RuntimeOrigin::signed(1), t),
        Error::<Test>::AlreadyUnbonding
      );
    })
  }

  #[test]
  fn frozen_title_refuses_revision_bumping_edits() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      set_live(t, false);
      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(1), t));
      assert_noop!(
        LemoTitle::set_identity(RuntimeOrigin::signed(1), t, h(9)),
        Error::<Test>::TitleFrozen
      );
      assert_noop!(
        LemoTitle::set_representation(RuntimeOrigin::signed(1), t, [1u8; 20]),
        Error::<Test>::TitleFrozen
      );
      assert_noop!(
        LemoTitle::transfer_owner(RuntimeOrigin::signed(1), t, 2),
        Error::<Test>::TitleFrozen
      );
      assert_eq!(crate::Titles::<Test>::get(t).unwrap().revision, 1);
    })
  }

  #[test]
  fn cancel_unbond_unfreezes_and_only_owner_can_cancel() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_noop!(
        LemoTitle::cancel_unbond(RuntimeOrigin::signed(1), t),
        Error::<Test>::NotUnbonding
      );
      set_live(t, false);
      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(1), t));
      assert_noop!(
        LemoTitle::cancel_unbond(RuntimeOrigin::signed(2), t),
        Error::<Test>::NotOwner
      );
      assert_ok!(LemoTitle::cancel_unbond(RuntimeOrigin::signed(1), t));
      assert!(crate::Unbonding::<Test>::get(t).is_none());
      assert_ok!(LemoTitle::set_identity(RuntimeOrigin::signed(1), t, h(9)));

      System::set_block_number(1 + PERIOD + 5);
      assert_noop!(
        LemoTitle::finalize_unbond(RuntimeOrigin::signed(2), t),
        Error::<Test>::NotUnbonding
      );
      assert!(crate::Titles::<Test>::get(t).is_some());
    })
  }

  #[test]
  fn finalize_is_refused_before_the_period() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      set_live(t, false);
      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(1), t));
      System::set_block_number(PERIOD); // due at 1 + PERIOD
      assert_noop!(
        LemoTitle::finalize_unbond(RuntimeOrigin::signed(2), t),
        Error::<Test>::UnbondingNotDue
      );
      assert!(crate::Titles::<Test>::get(t).is_some());
    })
  }

  #[test]
  fn finalize_rechecks_liveness() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      set_live(t, false);
      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(1), t));
      // Representation minted during the period.
      set_live(t, true);
      System::set_block_number(1 + PERIOD);
      assert_noop!(
        LemoTitle::finalize_unbond(RuntimeOrigin::signed(2), t),
        Error::<Test>::RepresentationLive
      );
      assert!(crate::Titles::<Test>::get(t).is_some());
      assert_eq!(Balances::reserved_balance(1), DEPOSIT);
    })
  }

  #[test]
  fn permissionless_finalize_deletes_and_unreserves_to_the_depositor() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      // Ownership moves; the deposit still belongs to the creator.
      assert_ok!(LemoTitle::transfer_owner(RuntimeOrigin::signed(1), t, 2));
      set_live(t, false);
      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(2), t));
      System::set_block_number(1 + PERIOD);
      assert_ok!(LemoTitle::finalize_unbond(RuntimeOrigin::signed(3), t));

      assert!(crate::Titles::<Test>::get(t).is_none());
      assert!(crate::CanonicalTitles::<Test>::get(t).is_none());
      assert!(crate::RepresentationLive::<Test>::get(t).is_none());
      assert!(crate::Unbonding::<Test>::get(t).is_none());
      assert!(crate::TitleDeposits::<Test>::get(t).is_none());
      assert_eq!(Balances::reserved_balance(1), 0);
      assert_eq!(Balances::free_balance(1), 1_000);
      System::assert_last_event(RuntimeEvent::LemoTitle(Event::Unbonded { title_id: t }));
    })
  }

  #[test]
  fn only_the_admin_can_mirror_representation_liveness() {
    new_test_ext().execute_with(|| {
      let t = create(1, 1);
      assert_noop!(
        LemoTitle::set_representation_live(RuntimeOrigin::signed(1), t, true),
        sp_runtime::DispatchError::BadOrigin
      );
    })
  }

  #[test]
  fn weights_are_per_call_and_carry_proof_size() {
    use frame_support::dispatch::GetDispatchInfo;
    let create = RuntimeCall::LemoTitle(crate::Call::create_title {
      salt: [0; 32],
      chain_id: 0,
      native_asset: h(0),
      backing: h(0),
      identity_hash: h(0),
      vesting_hash: h(0),
      permissions_hash: h(0),
      evm_beneficiary: [0; 20],
    })
    .get_dispatch_info()
    .call_weight;
    let live = RuntimeCall::LemoTitle(crate::Call::set_representation_live { title_id: h(0), live: true })
      .get_dispatch_info()
      .call_weight;
    let finalize = RuntimeCall::LemoTitle(crate::Call::finalize_unbond { title_id: h(0) })
      .get_dispatch_info()
      .call_weight;
    assert!(create.proof_size() > 0 && live.proof_size() > 0);
    assert!(create.ref_time() > live.ref_time());
    assert!(finalize.ref_time() > live.ref_time());
    assert_ne!(create.ref_time(), 10_000);
  }
}
