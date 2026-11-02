//! Native LEMO title registry.
//!
//! This pallet is the native half of the protocol: one record per title, a
//! monotonic revision, and the unbond guard that refuses to release backing
//! while an EVM representation is live. The EVM gates read the same record out
//! of a state proof; this pallet is what writes it.
//!
//! It is source and tests only. Including it in a runtime and deploying that
//! runtime is a chain upgrade, not a website change.

#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[frame_support::pallet]
pub mod pallet {
  use frame_support::pallet_prelude::*;
  use frame_system::pallet_prelude::*;

  /// The ten-field record the EVM commitment is computed over.
  #[derive(Clone, Eq, PartialEq, Encode, Decode, TypeInfo)]
  pub struct TitleRecord<AccountId, Hash> {
    pub title_id: Hash,
    pub chain_id: u64,
    pub native_asset: Hash,
    pub backing: Hash,
    pub owner: AccountId,
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
  }

  #[pallet::storage]
  #[pallet::unbounded]
  pub type Titles<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, TitleRecord<T::AccountId, T::Hash>, OptionQuery>;

  /// Mirrors whether an EVM representation currently has supply. The native
  /// chain cannot read EVM storage, so the bridge/runtime API writes this flag.
  ///
  /// `OptionQuery` is deliberate: an unwritten flag means "unknown", and an
  /// unknown representation is treated as live. Only an explicit `Some(false)`
  /// can authorise a native unbond.
  #[pallet::storage]
  pub type RepresentationLive<T: Config> =
    StorageMap<_, Blake2_128Concat, T::Hash, bool, OptionQuery>;

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
  }

  #[pallet::call]
  impl<T: Config> Pallet<T> {
    #[pallet::call_index(0)]
    #[pallet::weight(Weight::from_parts(10_000, 0))]
    pub fn create_title(
      origin: OriginFor<T>,
      title_id: T::Hash,
      chain_id: u64,
      native_asset: T::Hash,
      backing: T::Hash,
      identity_hash: T::Hash,
      vesting_hash: T::Hash,
      permissions_hash: T::Hash,
    ) -> DispatchResult {
      let owner = ensure_signed(origin)?;
      ensure!(!Titles::<T>::contains_key(title_id), Error::<T>::TitleExists);

      let record = TitleRecord {
        title_id,
        chain_id,
        native_asset,
        backing,
        owner: owner.clone(),
        identity_hash,
        vesting_hash,
        permissions_hash,
        evm_contract: [0u8; 20],
        revision: 1,
      };

      Titles::<T>::insert(title_id, record);
      Self::deposit_event(Event::TitleCreated { title_id, owner, revision: 1 });
      Ok(())
    }

    #[pallet::call_index(1)]
    #[pallet::weight(Weight::from_parts(10_000, 0))]
    pub fn set_identity(
      origin: OriginFor<T>,
      title_id: T::Hash,
      identity_hash: T::Hash,
    ) -> DispatchResult {
      let who = ensure_signed(origin)?;
      Self::mutate_owned(title_id, &who, |record| {
        record.identity_hash = identity_hash;
        Ok(())
      })
    }

    #[pallet::call_index(2)]
    #[pallet::weight(Weight::from_parts(10_000, 0))]
    pub fn set_representation(
      origin: OriginFor<T>,
      title_id: T::Hash,
      evm_contract: [u8; 20],
    ) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let mut record =
        Titles::<T>::get(title_id).ok_or(Error::<T>::TitleMissing)?;
      ensure!(record.owner == who, Error::<T>::NotOwner);
      record.evm_contract = evm_contract;
      record.revision = record
        .revision
        .checked_add(1)
        .ok_or(Error::<T>::RevisionOverflow)?;
      Titles::<T>::insert(title_id, &record);
      Self::deposit_event(Event::RepresentationChanged {
        title_id,
        contract: evm_contract,
        revision: record.revision,
      });
      Ok(())
    }

    /// Mirrors the EVM supply flag. Only the configured admin origin can write
    /// it, because the native chain cannot observe EVM balances by itself.
    #[pallet::call_index(3)]
    #[pallet::weight(Weight::from_parts(10_000, 0))]
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

    /// Rule 2: backing cannot leave while the representation is live.
    #[pallet::call_index(4)]
    #[pallet::weight(Weight::from_parts(10_000, 0))]
    pub fn request_unbond(origin: OriginFor<T>, title_id: T::Hash) -> DispatchResult {
      let who = ensure_signed(origin)?;
      let record = Titles::<T>::get(title_id).ok_or(Error::<T>::TitleMissing)?;
      ensure!(record.owner == who, Error::<T>::NotOwner);
      ensure!(
        RepresentationLive::<T>::get(title_id) == Some(false),
        Error::<T>::RepresentationLive
      );

      Titles::<T>::remove(title_id);
      RepresentationLive::<T>::remove(title_id);
      Self::deposit_event(Event::Unbonded { title_id });
      Ok(())
    }

    #[pallet::call_index(5)]
    #[pallet::weight(Weight::from_parts(10_000, 0))]
    pub fn transfer_owner(
      origin: OriginFor<T>,
      title_id: T::Hash,
      next: T::AccountId,
    ) -> DispatchResult {
      let who = ensure_signed(origin)?;
      Self::mutate_owned(title_id, &who, |record| {
        record.owner = next;
        Ok(())
      })
    }
  }

  impl<T: Config> Pallet<T> {
    fn mutate_owned(
      title_id: T::Hash,
      who: &T::AccountId,
      change: impl FnOnce(&mut TitleRecord<T::AccountId, T::Hash>) -> DispatchResult,
    ) -> DispatchResult {
      let mut record = Titles::<T>::get(title_id).ok_or(Error::<T>::TitleMissing)?;
      ensure!(&record.owner == who, Error::<T>::NotOwner);
      change(&mut record)?;
      record.revision = record
        .revision
        .checked_add(1)
        .ok_or(Error::<T>::RevisionOverflow)?;
      Titles::<T>::insert(title_id, &record);
      Self::deposit_event(Event::TitleUpdated {
        title_id,
        revision: record.revision,
      });
      Ok(())
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::pallet as lemo_title;
  use frame_support::{assert_noop, assert_ok, derive_impl};
  use sp_core::H256;
  use sp_runtime::BuildStorage;

  type Block = frame_system::mocking::MockBlock<Test>;

  frame_support::construct_runtime!(
    pub enum Test {
      System: frame_system,
      LemoTitle: lemo_title,
    }
  );

  #[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
  impl frame_system::Config for Test {
    type Block = Block;
    type RuntimeEvent = RuntimeEvent;
  }

  impl crate::pallet::Config for Test {
    type AdminOrigin = frame_system::EnsureRoot<u64>;
  }

  fn new_test_ext() -> sp_io::TestExternalities {
    frame_system::GenesisConfig::<Test>::default()
      .build_storage()
      .unwrap()
      .into()
  }

  fn h(n: u64) -> H256 {
    H256::from_low_u64_be(n)
  }

  #[test]
  fn creates_a_title_at_revision_one() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        420420777,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));

      let record = crate::Titles::<Test>::get(h(1)).expect("title exists");
      assert_eq!(record.owner, 1);
      assert_eq!(record.revision, 1);
      assert_eq!(record.evm_contract, [0u8; 20]);
    });
  }

  #[test]
  fn refuses_duplicate_title() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));
      assert_noop!(
        LemoTitle::create_title(
          RuntimeOrigin::signed(2),
          h(1),
          1,
          h(2),
          h(3),
          h(4),
          h(5),
          h(6)
        ),
        Error::<Test>::TitleExists
      );
    });
  }

  #[test]
  fn owner_edit_bumps_revision_and_stranger_cannot() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));
      assert_ok!(LemoTitle::set_identity(RuntimeOrigin::signed(1), h(1), h(9)));
      assert_eq!(crate::Titles::<Test>::get(h(1)).unwrap().revision, 2);

      assert_noop!(
        LemoTitle::set_identity(RuntimeOrigin::signed(2), h(1), h(10)),
        Error::<Test>::NotOwner
      );
    });
  }

  #[test]
  fn representation_change_bumps_revision() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));
      assert_ok!(LemoTitle::set_representation(
        RuntimeOrigin::signed(1),
        h(1),
        [1u8; 20],
      ));
      let record = crate::Titles::<Test>::get(h(1)).expect("title exists");
      assert_eq!(record.revision, 2);
      assert_eq!(record.evm_contract, [1u8; 20]);
    })
  }

  #[test]
  fn unbond_is_refused_while_representation_is_live() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));
      assert_ok!(LemoTitle::set_representation_live(
        RuntimeOrigin::root(),
        h(1),
        true
      ));

      assert_noop!(
        LemoTitle::request_unbond(RuntimeOrigin::signed(1), h(1)),
        Error::<Test>::RepresentationLive
      );
      assert!(crate::Titles::<Test>::get(h(1)).is_some());
    })
  }

  #[test]
  fn unbond_is_allowed_after_the_representation_is_gone() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));
      assert_ok!(LemoTitle::set_representation_live(
        RuntimeOrigin::root(),
        h(1),
        false
      ));

      assert_ok!(LemoTitle::request_unbond(RuntimeOrigin::signed(1), h(1)));
      assert!(crate::Titles::<Test>::get(h(1)).is_none());
    })
  }

  #[test]
  fn unbond_is_refused_while_representation_state_is_unknown() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));

      assert_noop!(
        LemoTitle::request_unbond(RuntimeOrigin::signed(1), h(1)),
        Error::<Test>::RepresentationLive
      );
    })
  }

  #[test]
  fn only_the_admin_can_mirror_representation_liveness() {
    new_test_ext().execute_with(|| {
      assert_ok!(LemoTitle::create_title(
        RuntimeOrigin::signed(1),
        h(1),
        1,
        h(2),
        h(3),
        h(4),
        h(5),
        h(6)
      ));

      assert_noop!(
        LemoTitle::set_representation_live(RuntimeOrigin::signed(1), h(1), true),
        sp_runtime::DispatchError::BadOrigin
      );
    })
  }
}
