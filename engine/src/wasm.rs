//! Internal UTF-8 memory ABI; only the worker's JS binding handles these pointers.
use crate::{ABI_VERSION, ENGINE_VERSION, Engine};
use std::{cell::RefCell, collections::BTreeMap};

#[derive(Default)]
struct Registry {
    next: u32,
    engines: BTreeMap<u32, Engine>,
    output: Vec<u8>,
}
thread_local! { static REGISTRY: RefCell<Registry> = RefCell::new(Registry::default()); }

#[unsafe(no_mangle)]
pub extern "C" fn abi_version() -> u32 {
    ABI_VERSION
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_version_ptr() -> u32 {
    ENGINE_VERSION.as_ptr() as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_version_len() -> u32 {
    ENGINE_VERSION.len() as u32
}
#[unsafe(no_mangle)]
pub extern "C" fn create_engine() -> u32 {
    REGISTRY.with_borrow_mut(|r| {
        if r.engines.len() >= 16 {
            return 0;
        }
        let Some(id) = r.next.checked_add(1) else {
            return 0;
        };
        r.next = id;
        r.engines.insert(id, Engine::default());
        id
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn destroy_engine(handle: u32) {
    REGISTRY.with_borrow_mut(|r| {
        r.engines.remove(&handle);
    });
}
#[unsafe(no_mangle)]
pub extern "C" fn alloc_json(len: u32) -> u32 {
    if len == 0 || len > 32 * 1024 * 1024 {
        return 0;
    }
    Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8 as u32
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free_json(ptr: u32, len: u32) {
    if ptr != 0 && len != 0 {
        // The JS binding passes exactly the allocation returned by alloc_json once.
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                ptr as *mut u8,
                len as usize,
            )));
        }
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dispatch_json(handle: u32, ptr: u32, len: u32) -> u32 {
    REGISTRY.with_borrow_mut(|r| {
        // The binding owns this input allocation until dispatch returns.
        let bytes = if ptr==0 || len>32*1024*1024 { &[] } else { unsafe { std::slice::from_raw_parts(ptr as *const u8,len as usize) } };
        let input=std::str::from_utf8(bytes).unwrap_or("");
        let response=match r.engines.get_mut(&handle) {
            Some(engine)=>engine.dispatch(input),
            None=>"[{\"schemaVersion\":1,\"simulationId\":\"unknown\",\"type\":\"error\",\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"Invalid engine handle\"}}]".into(),
        };
        r.output=response.into_bytes(); r.output.as_ptr() as u32
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn response_len() -> u32 {
    REGISTRY.with_borrow(|r| r.output.len() as u32)
}
