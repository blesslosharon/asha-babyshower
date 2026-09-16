/* =========================
   BABY BORN (admin)
========================= */

function babyBorn() {

    const name =
        document.getElementById("babyNameInput").value;

    const date =
        document.getElementById("babyDateInput").value;

    const time =
        document.getElementById("babyTimeInput").value;

    const photo =
        document.getElementById("babyPhotoInput").value;


    if (!name || !date || !time) {

        alert("Please enter Baby Name, Date and Time");

        return;

    }


    const babyData = {

        name: name,
        date: date,
        time: time,
        photo: photo

    };


    localStorage.setItem(
        "babyData",
        JSON.stringify(babyData)
    );


    document.getElementById(
        "adminMessage"
    ).innerHTML =
        "🎉 Baby announcement published!";


    alert(
        "🎉 Baby Born announcement published!"
    );

}
