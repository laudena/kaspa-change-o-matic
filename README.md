# change-o-matic
Kaspa Coin Machine. Turn that loose change into digital gold.

## Prototype Demo

### Live demo
[![Demo Video](https://img.youtube.com/vi/Oec0c7afvRI/maxresdefault.jpg)](https://www.youtube.com/watch?v=Oec0c7afvRI)

### User Interface Demo
[![Demo Video](https://img.youtube.com/vi/TCtLRDBi9RI/maxresdefault.jpg)](https://www.youtube.com/watch?v=TCtLRDBi9RI)

## Install
### Wiring Diagram
#### Ingridients
* 2 x 10kΩ Resistors
* 1 x 10µF Ceramic Capacitor (106)
* 1 x Raspberry Pi 5
* 1 x Tiny Code Reader (by Useful Sensors)
* 1 x 12V Power source
* 1 x 5V USB-C Power source

#### Breadboard layout
<img src="./media/coinOmatic_sketch.png" width=600px/>

* The Raspberry Pi and the Coin Acceptor use different power sources (12V and 5V respectively).
* In the future I will use a single power source, but for now I only connect their grounds, to receive the Coin Acceptor signal.


### UI

* cd ui

* npm install`

* Set the IP address of the Raspberry PI (where the python script is running) in `App.tsx`

### Server

* consider running in an environment:
  * `python -m venv myenv`
  * `source myenv/bin/activate`
  * `pip install -r requirements.txt`
  * note: when running outside the Raspberry Pi (for example, for testing), remove `lgpio` from the  requirements.txt list
    

## Run

* cd ui

* npm start

* cd server

* python3 click-socket.py

``` The python script will create a websocket running at `ws://0.0.0.0:8765`.
The ui will connect to that server's IP from the browser.```

* Open http://192.168.10.10:3000/ (use the Raspberry Pi's IP-Address)

## More Info

### TODO, known issues, limitations
* The monitor doesn't work properly at the moment. Failed transactions are registered in a separate file, but there's no active resubmission process after 10 minutes.
* I tried to come up with a full python application, but resolved to use the examples from `wasm` folder as a basis for my sub-processes. I will extract it out of the ruspy-kaspa folder
*

## Thanks and attributions
I Used Raspberry Pi case 3D print model from Tiramisu: https://www.printables.com/model/623697-raspberry-pi-5-case

