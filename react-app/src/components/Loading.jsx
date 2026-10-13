import React from 'react';
import './Loading.css'

function Loading() {
  return <div className="loading-container">
    <div className='loading three-balls-bounce'>
      <div className='ball-box'></div>
      <div className='ball-box'></div>
      <div className='ball-box'></div>
    </div>
  </div>
}

export default Loading;
