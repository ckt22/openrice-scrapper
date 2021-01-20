const puppeteer = require('puppeteer');
var admin = require("firebase-admin");
const axios = require('axios');

// var serviceAccount = require("./restaurant-menu-scrapper-firebase-adminsdk-5ndm6-df9ae33ce9.json");
var serviceAccount = require("./coach-ai-firebase-adminsdk-89vdc-c96b5d4a7b.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://coach-ai.firebaseio.com" // for writing to realtime database.
//   databaseURL: "https://restaurant-menu-scrapper.firebaseio.com"
});


// main program.
(async () => {
    try {
        // Scrape
        await scrapRestaurants();

        // Nutrition
        // let restaurants = await addNutritionInfo();

        // Firestore testing
        // let restaurants = await getStoredDataInFirestore();
        // await updateToFireStore([]);
    } catch (error) {
        console.log(error);
    }

})();

async function scrapRestaurants() {
    try {
        const browser = await puppeteer.launch( { headless: true });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
        await page.setDefaultNavigationTimeout(0);
        for(pageNumber=1; pageNumber<=17; pageNumber++) {
            let startingUrl = `https://www.openrice.com/en/hongkong/restaurants/district/tsuen-wan?page=${pageNumber}`
            // let startingUrl = `https://www.openrice.com/en/hongkong/restaurants?page=${pageNumber}`
            await page.goto(startingUrl, {
                waitUntil: 'networkidle2'
            });
            let restaurantsOfPage = await page.evaluate(() => {
    
                let restaurantObjsOfPage = [];
                let restaurantNames = Array.from(document.querySelectorAll('h2[class="title-name"]>a'), e => e.innerText);
                let restaurantLinks = Array.from(document.querySelectorAll('h2[class="title-name"]>a'), e => e.href);
                let restaurantAddresses = Array.from(document.querySelectorAll('div[class="icon-info address"]>span'), e => e.innerText);
    
                for (i=0; i<restaurantLinks.length; i++) {
                    restaurantObjsOfPage.push({
                        name: restaurantNames[i],
                        menuLink: restaurantLinks[i],
                        address: restaurantAddresses[i],
                    })
                }
                return restaurantObjsOfPage;
            });
    
            for (i=0; i<restaurantsOfPage.length; i++) {
                console.log(restaurantsOfPage[i].menuLink)
                await page.waitForTimeout(50);
                await page.goto(restaurantsOfPage[i].menuLink);
                await page.waitForTimeout(50);
                restaurantsOfPage[i].image = await page.evaluate(() => {
                    let image = document.querySelector('meta[itemprop=image]');
                    // (document.querySelector('meta[itemprop=image]').content);
                    return (!!image ? image.content : '');
                });
            }
    
            let newRestaurantArray = await getMenus(page, restaurantsOfPage);
            // saveToDataBase(newRestaurantArray);
            await addToFireStore(newRestaurantArray);
        }
        await page.close();
    } catch (error) {
        console.log(error);
    };
}

async function getMenus(page, restaurants) {

    let newRestaurantArray = [];
    for (var restaurant of restaurants) {
        let menuLink = restaurant.menuLink;
        console.log("fetching menu data");
        let restaurantId = menuLink.slice(-6);

        let menuUrl = `https://www.openrice.com/en/hongkong/menu/${restaurantId}/all?source=poiDetail`;

        try {
            await page.goto(menuUrl, {
                waitUntil: 'networkidle2'
            });

            let menu = await page.evaluate(() => {
                let nodeList = Array.from(document.querySelectorAll('span[class="text-trim poi-menu-item-info-name"]'),
                e => e.innerText);
                return nodeList;
            })
            newRestaurantArray.push({
                ...restaurant,
                menuData: menu,
            })
        } catch (error) {
            console.log(error);
        }
    }

    return newRestaurantArray;
}

// fetch restaurants from database, then add nutrition info.
async function addNutritionInfo() {
    try {
        let restaurants = await getStoredRestaurantsInFirebase();
        // let restaurants = await getStoredDataInFirestore();
        let count = 0;
    
        for (i=0; i<restaurants.length; i++) {
            console.log(`Checking ${restaurants[i].name}`)
            if (!!restaurants[i].menuData & !restaurants[i].menuDataWithNutritionInfo) {
                if (count + restaurants[i].menuData.length > 500) continue; else {
                    count += restaurants[i].menuData.length;
                    console.log(count);
                    let menuDataWithNutritionInfo = [];
                    for (var menuItem of restaurants[i].menuData) {
                        let nutritionValues = await axios.post(`https://api.nutritionix.com/v1_1/search`, {
                            "appId": "523f42f5", // 43bf0f71 / 523f42f5
                            "appKey": "87798566c7efbe667ee87814d13b1a2d", //  2c604e35de89d5238e30136c1dc9d077 / 87798566c7efbe667ee87814d13b1a2d
                            "query": menuItem,
                            "fields": [
                                "item_name",
                                "nf_calories",
                                "nf_sodium",
                                "nf_total_carbohydrate",
                                "nf_total_fat",
                                "nf_protein",
                                "nf_ingredient_statement",
                                "item_type",
                                "allergen_contains_milk",
                                "allergen_contains_eggs",
                                "allergen_contains_fish",
                                "allergen_contains_shellfish",
                                "allergen_contains_tree_nuts",
                                "allergen_contains_peanuts",
                                "allergen_contains_wheat",
                                "allergen_contains_soybeans",
                                "allergen_contains_gluten"
                            ]
                        }, {headers: {
                            'Content-Type': 'application/json'
                        }}).then(function (response) {
                            console.log(response.data);
                            return (response.data.hits.length > 0) ? response.data.hits[0].fields : "N.A."
                        }).catch(error => console.log(error));
            
                        updatedMenuItem = {
                            itemName: menuItem,
                            nutritionValues: !!nutritionValues ? nutritionValues : "N.A.",
                        }
                        menuDataWithNutritionInfo.push(updatedMenuItem);
                    }
                    restaurants[i].menuDataWithNutritionInfo = menuDataWithNutritionInfo;
                }
            } else continue;
        }
    
        // save to database
        // saveToDataBase(restaurants);
        updateToFireStore(restaurants);
        return restaurants;
    } catch (error) {
        console.log(error);
    }
}

// Promise for fetching from database
function getStoredRestaurantsInFirebase() {

    try {
        console.log("Fetching documents from database.")
        let db = admin.database();
        let ref = db.ref("restaurants/openrice");
        let restaurants = [];
        ref.once('value', function(snapshot) {
            snapshot.forEach(function(childSnapshot) {
              var childKey = childSnapshot.key;
              var childData = childSnapshot.val();
              restaurants.push({
                  childKey,
                  ...childData
              });
            });
        });
        return new Promise(function(resolve, reject) {
            setTimeout(function() {
              resolve(restaurants);
            }, 3000);
          });
    } catch (error) {
        console.log(error);
    }
}

async function getStoredDataInFirestore() {
    try {
        console.log("Fetching documents from database.")
        let db = admin.firestore();
        let ref = db.collection("restaurants");
        let restaurants = [];
        const snapshot = await ref.where('menuData', '!=', []).get();
        snapshot.forEach(doc => {
            restaurants.push(doc.data())
        });
        console.log(restaurants);
        return restaurants;

    } catch (error) {
        console.log(error);
    }
}

// saves to my firebase database.
function saveToDataBase(restaurants) {
    console.log("Ready to save data to database.")
    var db = admin.database();
    var ref = db.ref("restaurants/openrice");

    for (var restaurant of restaurants) {
        let pathname = restaurant.name.replace(/\[.*?\]/g, '');
        pathname = pathname.replace(/[.#$]/g, '');
        var newRef = ref.child(pathname);
        newRef.update(restaurant);
    }

    console.log("Data saved to database.")
}

async function addToFireStore(restaurants) {
    console.log("Ready to save data to database.")
    var db = admin.firestore();
    var ref = db.collection('restaurants');
    for (var restaurant of restaurants) {
        let docRef = ref.doc(restaurant.name);
        if (restaurant.menuData.length > 0) {
            await docRef.set(restaurant);
        }
    }
    console.log("Data saved to firestore.")
}

async function updateToFireStore(restaurants) {
    console.log("Ready to save data to database.")
    var db = admin.firestore();
    var ref = db.collection('restaurants');

    // var jobskill_query = ref.where('menuData', '==', []);
    // jobskill_query.get().then(function(querySnapshot) {
    //     querySnapshot.forEach(function(doc) {
    //         doc.ref.delete();
    //     });
    // });

    for (var restaurant of restaurants) {
        let docRef = ref.doc(restaurant.name);
        await docRef.update(restaurant);
    }
    console.log("Data updated to firestore.")
}

